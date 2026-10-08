"""Workspace-scoped feed snapshots with nonblocking, merged refreshes."""

from __future__ import annotations

import copy
import json
import os
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from .. import workspace
from . import sources


_locks_guard = threading.Lock()
_locks: dict[str, threading.RLock] = {}
_running: set[str] = set()
_last_started: dict[str, float] = {}
_REFRESH_COOLDOWN_SECONDS = 30
_RETRY_SECONDS = 300
MAX_CACHE_BYTES = 64 * 1024 * 1024


class FeedCacheError(RuntimeError):
    """Refuse to overwrite personal data that cannot be safely loaded or saved."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _timestamp(date: datetime) -> str:
    return date.isoformat().replace("+00:00", "Z")


def _root() -> Path:
    root = workspace.current_workspace_root()
    if root is None:
        raise RuntimeError("首页资讯需要已登录的账号工作区")
    return root


def _key(root: Path) -> str:
    return str(root.resolve())


def _lock(root: Path) -> threading.RLock:
    with _locks_guard:
        return _locks.setdefault(_key(root), threading.RLock())


def _empty() -> dict[str, Any]:
    return {"version": 1, "preferences": {"topics": ["AI", "Agent", "MCP"], "repositories": []}, "item_states": {}, "bookmarked_items": {}, "source_cache": {}}


def _load(root: Path) -> dict[str, Any]:
    path = root / "home-feed.json"
    try:
        with path.open("rb") as handle:
            content = handle.read(MAX_CACHE_BYTES + 1)
    except FileNotFoundError:
        return _empty()
    except OSError as exc:
        raise FeedCacheError("首页资讯缓存暂时无法读取，原文件已保留") from exc
    if len(content) > MAX_CACHE_BYTES:
        raise FeedCacheError("首页资讯缓存超过 64 MiB 容量限制，原文件已保留，请先备份并整理")
    try:
        payload = json.loads(content.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise FeedCacheError("首页资讯缓存内容损坏，原文件已保留，请从备份恢复") from exc
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise FeedCacheError("首页资讯缓存版本不受支持，原文件已保留")
    if not all(isinstance(payload.get(key), dict) for key in ("preferences", "item_states", "source_cache")):
        raise FeedCacheError("首页资讯缓存结构不完整，原文件已保留")
    if not isinstance(payload.setdefault("bookmarked_items", {}), dict):
        raise FeedCacheError("首页资讯收藏缓存结构不完整，原文件已保留")
    return payload


def _save(root: Path, payload: dict[str, Any]) -> None:
    # Count encoded bytes, not characters: Chinese release notes and long-term
    # bookmark snapshots can legitimately grow beyond the old 4 MB read limit.
    # Reject before creating a temporary file or replacing the existing cache.
    content = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(content) > MAX_CACHE_BYTES:
        raise FeedCacheError("首页资讯缓存已达到 64 MiB 容量限制，本次修改未保存；请先取消部分收藏")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = root / "home-feed.json"
    temporary = root / f".home-feed-{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("xb") as handle:
            os.chmod(temporary, 0o600)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _due(source: sources.Source, cached: dict[str, Any], now: datetime) -> bool:
    attempted = sources.published_date(cached.get("last_attempt_at"))
    if not attempted:
        return True
    elapsed = (now - datetime.fromisoformat(attempted.replace("Z", "+00:00"))).total_seconds()
    return elapsed >= (_RETRY_SECONDS if cached.get("error") else source.ttl_seconds)


def _failure_message(error: Exception) -> str:
    if isinstance(error, httpx.HTTPStatusError):
        if error.response.status_code == 429:
            return "来源请求受限，将稍后重试；已有内容继续保留"
        if error.response.status_code == 404:
            return "来源不存在或仓库不是公开仓库"
        return f"来源暂时不可用（HTTP {error.response.status_code}），已有内容继续保留"
    if isinstance(error, httpx.TimeoutException):
        return "来源请求超时，已有内容继续保留"
    if isinstance(error, ValueError):
        return str(error)[:180]
    return "来源暂时无法连接，已有内容继续保留"


def _refresh(selected: list[sources.Source]) -> None:
    root = _root()
    try:
        for source in selected:
            try:
                items = sources.fetch_source(source)
                error = None
            except Exception as exc:
                items = None
                error = _failure_message(exc)
            attempted = _timestamp(_now())
            with _lock(root):
                payload = _load(root)
                active = {item.id for item in sources.configured_sources(payload["preferences"].get("repositories", []))}
                if source.id not in active:
                    continue
                previous = payload["source_cache"].get(source.id, {})
                cached = {**previous, "last_attempt_at": attempted, "error": error}
                if items is not None:
                    cached.update({"items": items, "last_success_at": attempted})
                payload["source_cache"][source.id] = cached
                _save(root, payload)
    finally:
        with _lock(root):
            _running.discard(_key(root))


def start_refresh(*, force: bool = False) -> bool:
    root = _root()
    key = _key(root)
    with _lock(root):
        if key in _running:
            return False
        tick = time.monotonic()
        if force and tick - _last_started.get(key, float("-inf")) < _REFRESH_COOLDOWN_SECONDS:
            return False
        payload = _load(root)
        all_sources = sources.configured_sources(payload["preferences"].get("repositories", []))
        selected = [source for source in all_sources if force or _due(source, payload["source_cache"].get(source.id, {}), _now())]
        if not selected:
            return False
        _running.add(key)
        _last_started[key] = tick
        try:
            workspace.spawn_thread(_refresh, args=(selected,), name="home-feed-refresh")
        except Exception:
            _running.discard(key)
            raise
        return True


def _recent_news(items: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    cutoff = now - timedelta(days=7)
    result = []
    for item in items:
        published = sources.published_date(item.get("published_at"))
        # An undated item is preserved with a null date. The UI can explicitly
        # distinguish it rather than giving it today's collection timestamp.
        if published and datetime.fromisoformat(published.replace("Z", "+00:00")) < cutoff:
            continue
        result.append(item)
    return result


def get_feed(*, refresh_if_due: bool = True) -> dict[str, Any]:
    if refresh_if_due:
        start_refresh()
    root = _root()
    with _lock(root):
        payload = _load(root)
        refreshing = _key(root) in _running
        snapshot: dict[str, Any] = {
            "news": [], "repositories": {"day": [], "week": []}, "updates": [], "practices": [],
            "sources": [], "preferences": copy.deepcopy(payload["preferences"]),
            "item_states": copy.deepcopy(payload["item_states"]),
            "bookmarks": copy.deepcopy(list(reversed(payload["bookmarked_items"].values()))),
            "refreshing": refreshing, "last_synced_at": None,
        }
        successes = []
        for source in sources.configured_sources(payload["preferences"].get("repositories", [])):
            cached = payload["source_cache"].get(source.id, {})
            items = copy.deepcopy(cached.get("items", []))
            succeeded = cached.get("last_success_at")
            if succeeded:
                successes.append(succeeded)
            snapshot["sources"].append({
                "id": source.id, "label": source.label, "kind": source.kind, "url": source.url,
                "status": "error" if cached.get("error") else "ready" if items else "loading" if refreshing and not succeeded else "empty",
                "last_success_at": succeeded, "error": cached.get("error"),
            })
            if source.kind == "news":
                snapshot["news"].extend(_recent_news(items, _now()))
            elif source.kind == "github":
                snapshot["repositories"]["day" if source.id == "github-day" else "week"].extend(items)
            elif source.kind == "stack":
                snapshot["updates"].extend(items)
            elif source.kind == "practice":
                snapshot["practices"].extend(items)
        snapshot["last_synced_at"] = max(successes) if successes else None
        for name in ("news", "updates"):
            snapshot[name].sort(key=lambda item: item.get("published_at") or "", reverse=True)
        return snapshot


def save_preferences(topics: list[str], repositories: list[str]) -> dict[str, Any]:
    if len(topics) > len(sources.TOPICS) or any(topic not in sources.TOPICS for topic in topics):
        raise ValueError("兴趣主题需选择 AI、Agent、MCP、RAG、评测或开发工具")
    if len(repositories) > 8:
        raise ValueError("最多关注 8 个公开仓库")
    normalized = []
    seen = set()
    for value in repositories:
        repo = sources.normalize_repository(value)
        if repo.casefold() not in seen:
            seen.add(repo.casefold())
            normalized.append(repo)
    root = _root()
    with _lock(root):
        payload = _load(root)
        payload["preferences"] = {"topics": list(dict.fromkeys(topics)), "repositories": normalized}
        active = {source.id for source in sources.configured_sources(normalized)}
        payload["source_cache"] = {key: value for key, value in payload["source_cache"].items() if key in active}
        _save(root, payload)
    return get_feed()


def set_item_state(item_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    if not patch or any(key not in {"bookmarked", "hidden"} or not isinstance(value, bool) for key, value in patch.items()):
        raise ValueError("请提供有效的收藏或隐藏状态")
    root = _root()
    with _lock(root):
        payload = _load(root)
        kinds = {source.id: source.kind for source in sources.configured_sources(payload["preferences"].get("repositories", []))}
        matching = next((
            {"kind": kinds[source_id], "item": item}
            for source_id, cached in payload["source_cache"].items() if source_id in kinds
            for item in cached.get("items", []) if item["id"] == item_id
        ), None)
        snapshot = matching or payload["bookmarked_items"].get(item_id)
        if snapshot is None and item_id not in payload["item_states"]:
            raise LookupError("资讯不存在或已不在缓存中")
        if patch.get("bookmarked") is True and snapshot is None:
            raise LookupError("该资讯已不在缓存中，无法保存收藏快照")
        states = payload["item_states"]
        if item_id not in states and len(states) >= 2000:
            raise ValueError("已保存的资讯状态过多，请取消部分收藏或隐藏")
        state = {"bookmarked": False, "hidden": False, **states.get(item_id, {}), **patch}
        if patch.get("bookmarked") is True:
            payload["bookmarked_items"][item_id] = copy.deepcopy(snapshot)
        elif patch.get("bookmarked") is False:
            payload["bookmarked_items"].pop(item_id, None)
        if state["bookmarked"] or state["hidden"]:
            states[item_id] = state
        else:
            states.pop(item_id, None)
        _save(root, payload)
    return get_feed(refresh_if_due=False)

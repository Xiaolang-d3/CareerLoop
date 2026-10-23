"""Workspace-scoped feed snapshots with nonblocking, merged refreshes."""

from __future__ import annotations

import copy
import json
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextvars import copy_context
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from .. import workspace
from . import benchmarks, media_benchmarks, model_news, sources
from .public_cache import PublicSourceCache


_locks_guard = threading.Lock()
_locks: dict[str, threading.RLock] = {}
_running: set[str] = set()
_last_started: dict[str, float] = {}
_REFRESH_COOLDOWN_SECONDS = 30
_RETRY_SECONDS = 300
MAX_CACHE_BYTES = 64 * 1024 * 1024
_public_cache = PublicSourceCache()


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
    return {"version": 1, "preferences": {"topics": ["AI", "Agent", "MCP"], "repositories": []}, "item_states": {}, "bookmarked_items": {}, "source_cache": {}, "digest": {"profile_id": "", "cache": None}}


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
    digest = payload.setdefault("digest", {})
    if not isinstance(digest, dict):
        raise FeedCacheError("首页资讯日报缓存结构不完整，原文件已保留")
    if not isinstance(digest.setdefault("profile_id", ""), str) or len(digest["profile_id"]) > 64:
        raise FeedCacheError("首页资讯日报设置不完整，原文件已保留")
    digest.setdefault("cache", None)
    if digest["cache"] is not None and not isinstance(digest["cache"], dict):
        raise FeedCacheError("首页资讯日报缓存结构不完整，原文件已保留")
    if not isinstance(payload["preferences"].get("curation_enabled", False), bool):
        raise FeedCacheError("首页资讯精选设置不完整，原文件已保留")
    curation = payload.setdefault("curation", {})
    if not isinstance(curation, dict) or not isinstance(curation.get("history", []), list):
        raise FeedCacheError("首页资讯精选缓存结构不完整，原文件已保留")
    if curation.get("cache") is not None and not isinstance(curation["cache"], dict):
        raise FeedCacheError("首页资讯精选缓存结构不完整，原文件已保留")
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
    retry_seconds = 3600 if source.adapter in {"market_search", "aa_api", "aa_media"} else _RETRY_SECONDS
    return elapsed >= (retry_seconds if cached.get("error") else source.ttl_seconds)


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


def _fetch_public_source(source: sources.Source, force: bool):
    return _public_cache.get(
        source, url=source.url, ttl=source.ttl_seconds, force=force and source.adapter not in {"market_search", "aa_api", "aa_media"},
        now=lambda: _now().timestamp(), load=lambda: sources.fetch_source(source),
    )


def _refresh(selected: list[sources.Source], force: bool = False) -> None:
    root = _root()
    try:
        # A slow origin must not delay publishing updates from healthy sources.
        # Each worker gets its own copy of the account's workspace context.
        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="home-source") as executor:
            pending = {executor.submit(copy_context().run, _fetch_public_source, source, force): source for source in selected}
            for future in as_completed(pending):
                source = pending[future]
                try:
                    result = future.result()
                    items = result.items
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
                        cached.update({
                            "items": items,
                            "last_success_at": _timestamp(datetime.fromtimestamp(result.checked_at, timezone.utc)),
                            "fetched_at": _timestamp(datetime.fromtimestamp(result.fetched_at, timezone.utc)),
                        })
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
        selected = [source for source in all_sources if (force and source.adapter != "market_search") or _due(source, payload["source_cache"].get(source.id, {}), _now())]
        if not selected:
            return False
        _running.add(key)
        _last_started[key] = tick
        try:
            workspace.spawn_thread(_refresh, args=(selected, force), name="home-feed-refresh")
        except Exception:
            _running.discard(key)
            raise
        return True


def _recent_news(items: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    cutoff = now - timedelta(days=7)
    result = []
    eligible = []
    for item in items:
        published = sources.published_date(item.get("published_at"))
        if published and datetime.fromisoformat(published.replace("Z", "+00:00")) > now:
            continue
        eligible.append(item)
        # An undated item is preserved with a null date. The UI can explicitly
        # distinguish it rather than giving it today's collection timestamp.
        if published and datetime.fromisoformat(published.replace("Z", "+00:00")) < cutoff:
            continue
        result.append(item)
    # A publisher may announce models only every few months. Retain its latest
    # notices with their real dates instead of making that publisher disappear.
    return result or sorted(eligible, key=lambda item: item.get("published_at") or "", reverse=True)[:3]


def get_feed(*, refresh_if_due: bool = True) -> dict[str, Any]:
    if refresh_if_due:
        start_refresh()
    root = _root()
    with _lock(root):
        payload = _load(root)
        refreshing = _key(root) in _running
        snapshot: dict[str, Any] = {
            "news": [], "model_news": [],
            "model_benchmarks": {"models": [], "status": "unconfigured", "error": None, "collected_at": None,
                                 "source_url": benchmarks.SOURCE_URL, "docs_url": benchmarks.DOCS_URL, "media": []},
            "repositories": {"day": [], "week": []}, "updates": [], "practices": [],
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
                "publisher": source.publisher,
            })
            if source.kind == "news":
                snapshot["news"].extend(_recent_news(items, _now()))
                snapshot["model_news"].extend(_recent_news(model_news.select(items), _now()))
            elif source.adapter == "aa_media":
                board = next(board for board in media_benchmarks.BOARDS if board.source_id == source.id)
                snapshot["model_benchmarks"]["media"].append({
                    "id": board.id, "category": board.category, "label": board.label, "metric": board.metric,
                    "source_url": board.source_url, "models": items, "status": snapshot["sources"][-1]["status"],
                    "collected_at": cached.get("fetched_at") or succeeded, "error": cached.get("error"),
                })
            elif source.kind == "benchmark":
                snapshot["model_benchmarks"].update({"models": items, "status": snapshot["sources"][-1]["status"],
                                                     "collected_at": cached.get("fetched_at") or succeeded, "error": cached.get("error")})
            elif source.kind == "github":
                snapshot["repositories"]["day" if source.id == "github-day" else "week"].extend(items)
            elif source.kind == "stack":
                snapshot["updates"].extend(items)
            elif source.kind == "practice":
                snapshot["practices"].extend(items)
        snapshot["last_synced_at"] = max(successes) if successes else None
        snapshot["news"] = list({item["id"]: item for item in snapshot["news"]}.values())
        snapshot["model_news"] = list({item["id"]: item for item in snapshot["model_news"]}.values())
        for name in ("news", "model_news", "updates"):
            snapshot[name].sort(key=lambda item: item.get("published_at") or "", reverse=True)
        from . import digest as digest_module

        snapshot["preferences"]["digest_profile_id"] = payload["digest"]["profile_id"]
        snapshot["digest"] = digest_module.describe(payload, snapshot)
        from . import curation

        snapshot["curation"] = curation.describe(payload)
    if refresh_if_due:
        from . import digest as digest_module

        digest_started = digest_module.maybe_start()
        curation_started = curation.maybe_start()
        if digest_started or curation_started:
            # A previous day's cached card must report the newly reserved run,
            # otherwise the browser sees only stale and never starts polling.
            with _lock(root):
                current = _load(root)
                if digest_started:
                    snapshot["digest"] = digest_module.describe(current, snapshot)
                if curation_started:
                    snapshot["curation"] = curation.describe(current)
    return snapshot


def save_preferences(topics: list[str], repositories: list[str], digest_profile_id: str | None = None, *, curation_enabled: bool | None = None) -> dict[str, Any]:
    if len(topics) > len(sources.TOPICS) or any(topic not in sources.TOPICS for topic in topics):
        raise ValueError("兴趣主题需选择 AI、Agent、MCP、RAG、评测或开发工具")
    if len(repositories) > 8:
        raise ValueError("最多关注 8 个公开仓库")
    if digest_profile_id is not None and len(digest_profile_id) > 64:
        raise ValueError("日报模型 ID 格式不正确")
    normalized = []
    seen = set()
    for value in repositories:
        repo = sources.normalize_repository(value)
        if repo.casefold() not in seen:
            seen.add(repo.casefold())
            normalized.append(repo)
    if digest_profile_id is not None:
        from . import digest as digest_module

        digest_module.validate_profile(digest_profile_id)
    root = _root()
    with _lock(root):
        payload = _load(root)
        enabled = payload["preferences"].get("curation_enabled", False) if curation_enabled is None else curation_enabled
        selected_profile = payload["digest"]["profile_id"] if digest_profile_id is None else digest_profile_id
        if not isinstance(enabled, bool):
            raise ValueError("资讯精选开关需为布尔值")
        if enabled and not selected_profile:
            raise ValueError("请先选择文本日报模型，再启用每日资讯精选")
        previous_contract = (payload["preferences"].get("curation_enabled", False), payload["preferences"].get("topics"), payload["digest"]["profile_id"])
        payload["preferences"] = {"topics": list(dict.fromkeys(topics)), "repositories": normalized}
        if curation_enabled is not None or enabled:
            payload["preferences"]["curation_enabled"] = enabled
        if digest_profile_id is not None:
            payload["digest"]["profile_id"] = digest_profile_id
        if previous_contract != (enabled, payload["preferences"]["topics"], selected_profile):
            payload.setdefault("curation", {})["revision"] = uuid.uuid4().hex
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
            for source_id, cached in payload["source_cache"].items() if kinds.get(source_id) in {"news", "practice", "github", "stack"}
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

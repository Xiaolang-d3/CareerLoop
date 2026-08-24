from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

import httpx

from ..config import get_settings
from ..version import USER_AGENT


MAX_TREE_PATHS = 400
MAX_README_CHARS = 80_000
GITHUB_API = "https://api.github.com"
_RESERVED_OWNERS = {
    "about", "account", "apps", "codespaces", "collections", "enterprise",
    "explore", "features", "issues", "login", "marketplace", "new",
    "notifications", "organizations", "orgs", "pricing", "pulls", "search",
    "security", "settings", "signup", "sponsors", "topics",
}
_SKIP_DIR_PARTS = {
    ".git", ".github", ".idea", ".next", ".venv", ".vscode",
    "__pycache__", "build", "coverage", "dist", "node_modules",
    "out", "target", "vendor", "venv",
}
_SKIP_SUFFIXES = (
    ".dll", ".dylib", ".eot", ".exe", ".gif", ".ico", ".jpeg", ".jpg",
    ".lock", ".map", ".min.css", ".min.js", ".mp3", ".mp4", ".png",
    ".pyc", ".so", ".ttf", ".webp", ".woff", ".woff2",
)
_SKIP_NAMES = {
    "cargo.lock", "package-lock.json", "pnpm-lock.yaml", "poetry.lock", "yarn.lock",
}
_SHORT_RE = re.compile(r"^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?$")
_OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$")
_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def parse_github_repo_url(raw: str) -> tuple[str, str]:
    text = (raw or "").strip()
    if not text:
        raise ValueError("请粘贴 GitHub 仓库地址")
    if "://" not in text and "/" in text and " " not in text:
        match = _SHORT_RE.fullmatch(text.rstrip("/"))
        if match:
            return _validated_owner_repo(match.group(1), match.group(2))
        raise ValueError("仓库地址格式无效，请使用 owner/repo 或 GitHub 链接")
    parsed = urlparse(text if "://" in text else f"https://{text}")
    host = (parsed.hostname or "").lower()
    if host not in {"github.com", "www.github.com"}:
        raise ValueError("目前只支持公开的 github.com 仓库")
    parts = [item for item in (parsed.path or "").split("/") if item]
    if len(parts) < 2:
        raise ValueError("仓库地址缺少 owner/repo")
    owner, repo = parts[0], parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    return _validated_owner_repo(owner, repo)


def filter_tree_paths(paths: list[str], *, limit: int = MAX_TREE_PATHS) -> list[str]:
    kept: list[str] = []
    seen: set[str] = set()
    for raw in paths:
        path = _normalize_path(raw)
        if not path or path in seen or not _keep_path(path):
            continue
        seen.add(path)
        kept.append(path)
        if len(kept) >= limit:
            break
    return kept


def path_on_tree(path: str, tree_paths: list[str] | set[str]) -> bool:
    cleaned = _normalize_path(path)
    if not cleaned:
        return False
    tree = tree_paths if isinstance(tree_paths, set) else set(tree_paths)
    if cleaned in tree:
        return True
    prefix = cleaned if cleaned.endswith("/") else f"{cleaned}/"
    return any(item.startswith(prefix) for item in tree)


def representative_paths(paths: list[str], *, limit: int = 16) -> list[str]:
    buckets: dict[str, list[str]] = {}
    for path in sorted(paths, key=lambda item: (item.count("/"), len(item), item)):
        buckets.setdefault(path.split("/", 1)[0], []).append(path)
    picked: list[str] = []
    while len(picked) < limit and any(buckets.values()):
        for root in list(buckets):
            items = buckets[root]
            if not items:
                continue
            picked.append(items.pop(0))
            if len(picked) >= limit:
                break
    return picked


async def fetch_github_repo_snapshot(
    owner: str,
    repo: str,
    *,
    token: str | None = None,
    timeout_seconds: float = 20,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
    }
    resolved_token = (token if token is not None else get_settings().github_token or "").strip()
    if resolved_token:
        headers["Authorization"] = f"Bearer {resolved_token}"
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=timeout_seconds, headers=headers)
    try:
        if client is not None:
            http.headers.update(headers)
        repo_payload = await _github_json(http, f"{GITHUB_API}/repos/{owner}/{repo}")
        default_branch = str(repo_payload.get("default_branch") or "").strip()
        if not default_branch:
            raise ValueError("无法读取仓库默认分支")
        tree_payload = await _github_json(
            http,
            f"{GITHUB_API}/repos/{owner}/{repo}/git/trees/{default_branch}",
            params={"recursive": "1"},
        )
        if tree_payload.get("truncated"):
            raise ValueError("仓库目录过大，无法完整校验路径")
        raw_paths = [
            str(item.get("path") or "")
            for item in tree_payload.get("tree") or []
            if isinstance(item, dict) and item.get("type") == "blob"
        ]
        paths = filter_tree_paths(raw_paths)
        if not paths:
            raise ValueError("这个仓库没有可分析的源码文件")
        readme = await _github_readme(http, owner, repo)
        return {
            "owner": owner,
            "repo": repo,
            "default_branch": default_branch,
            "html_url": str(repo_payload.get("html_url") or f"https://github.com/{owner}/{repo}"),
            "paths": paths,
            "readme": readme[:MAX_README_CHARS],
        }
    except httpx.TimeoutException as exc:
        raise ValueError("拉取仓库超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise ValueError("无法连接 GitHub，请稍后重试") from exc
    finally:
        if owns_client:
            await http.aclose()


def _validated_owner_repo(owner: str, repo: str) -> tuple[str, str]:
    owner = owner.strip()
    repo = repo.strip()
    if owner.lower() in _RESERVED_OWNERS:
        raise ValueError("这不是一个仓库地址")
    if not _OWNER_RE.fullmatch(owner) or not _REPO_RE.fullmatch(repo) or repo in {".", ".."}:
        raise ValueError("仓库地址格式无效，请使用 owner/repo 或 GitHub 链接")
    return owner, repo


def _normalize_path(path: str) -> str:
    cleaned = (path or "").strip().replace("\\", "/")
    cleaned = re.sub(r"^(\./)+", "", cleaned)
    if not cleaned or ".." in cleaned.split("/") or cleaned.startswith("/"):
        return ""
    return cleaned


def _keep_path(path: str) -> bool:
    parts = path.split("/")
    name = parts[-1].lower()
    if name in _SKIP_NAMES:
        return False
    if any(part in _SKIP_DIR_PARTS for part in parts[:-1]):
        return False
    lowered = path.lower()
    return not any(lowered.endswith(suffix) for suffix in _SKIP_SUFFIXES)


async def _github_json(
    client: httpx.AsyncClient,
    url: str,
    *,
    params: dict[str, str] | None = None,
) -> dict[str, Any]:
    response = await client.get(url, params=params)
    _raise_github_status(response)
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("GitHub 返回的仓库数据无效")
    return payload


async def _github_readme(client: httpx.AsyncClient, owner: str, repo: str) -> str:
    response = await client.get(
        f"{GITHUB_API}/repos/{owner}/{repo}/readme",
        headers={"Accept": "application/vnd.github.raw"},
    )
    if response.status_code == 404:
        return ""
    _raise_github_status(response)
    return response.text


def _raise_github_status(response: httpx.Response) -> None:
    if response.status_code == 404:
        raise ValueError("仓库不存在或未公开")
    if response.status_code == 401:
        raise ValueError("GitHub 令牌无效")
    if response.status_code == 403:
        raise ValueError("GitHub 暂时拒绝访问，请稍后重试或配置 GITHUB_TOKEN")
    if response.status_code >= 400:
        raise ValueError("拉取仓库失败，请稍后重试")

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.projects.github_repo import (
    fetch_github_repo_snapshot,
    filter_tree_paths,
    parse_github_repo_url,
    path_on_tree,
    representative_paths,
)


def test_parse_accepts_url_and_short_form() -> None:
    assert parse_github_repo_url("https://github.com/yamadashy/repomix") == ("yamadashy", "repomix")
    assert parse_github_repo_url("https://github.com/yamadashy/repomix.git") == ("yamadashy", "repomix")
    assert parse_github_repo_url("https://github.com/yamadashy/repomix/tree/main") == ("yamadashy", "repomix")
    assert parse_github_repo_url("owner/repo") == ("owner", "repo")


def test_parse_rejects_non_github_hosts() -> None:
    with pytest.raises(ValueError, match="github.com"):
        parse_github_repo_url("https://gitlab.com/owner/repo")
    with pytest.raises(ValueError, match="不是一个仓库"):
        parse_github_repo_url("https://github.com/settings/tokens")
    with pytest.raises(ValueError, match="缺少 owner/repo"):
        parse_github_repo_url("https://github.com/only-owner")


def test_filter_drops_noise_and_caps_size() -> None:
    paths = filter_tree_paths([
        "frontend/src/app.tsx",
        "node_modules/react/index.js",
        "dist/bundle.js",
        "logo.png",
        "package-lock.json",
        "backend/app/main.py",
        "../escape.py",
    ], limit=10)
    assert paths == ["frontend/src/app.tsx", "backend/app/main.py"]


def test_path_on_tree_accepts_file_or_directory_prefix() -> None:
    tree = ["frontend/src/app.tsx", "backend/app/main.py"]
    assert path_on_tree("frontend/src/app.tsx", tree)
    assert path_on_tree("frontend/src", tree)
    assert not path_on_tree("secret/vault.py", tree)


def test_representative_paths_round_robin_roots() -> None:
    picked = representative_paths([
        "frontend/a.tsx",
        "frontend/b.tsx",
        "backend/a.py",
        "backend/b.py",
    ], limit=2)
    assert picked == ["backend/a.py", "frontend/a.tsx"]


def test_fetch_snapshot_uses_mocked_github(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.projects.github_repo.get_settings", lambda: type("S", (), {"github_token": ""})())

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/repos/acme/voice"):
            return httpx.Response(200, json={"default_branch": "main", "html_url": "https://github.com/acme/voice"})
        if "git/trees/main" in url:
            return httpx.Response(200, json={
                "truncated": False,
                "tree": [
                    {"path": "frontend/src/audio/capture.ts", "type": "blob"},
                    {"path": "backend/app/asr.py", "type": "blob"},
                    {"path": "node_modules/react/index.js", "type": "blob"},
                    {"path": "docs", "type": "tree"},
                ],
            })
        if url.endswith("/readme"):
            return httpx.Response(200, text="# Voice\nPCM 采集后做 Opus 编码。")
        return httpx.Response(404, json={"message": "missing"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    snapshot = asyncio.run(fetch_github_repo_snapshot("acme", "voice", client=client, token=""))
    assert snapshot["default_branch"] == "main"
    assert snapshot["paths"] == ["frontend/src/audio/capture.ts", "backend/app/asr.py"]
    assert "Opus" in snapshot["readme"]


def test_truncated_tree_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.projects.github_repo.get_settings", lambda: type("S", (), {"github_token": ""})())

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith("/repos/acme/huge"):
            return httpx.Response(200, json={"default_branch": "main", "html_url": "https://github.com/acme/huge"})
        if "git/trees/main" in url:
            return httpx.Response(200, json={"truncated": True, "tree": [{"path": "a.py", "type": "blob"}]})
        return httpx.Response(404)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(ValueError, match="过大"):
        asyncio.run(fetch_github_repo_snapshot("acme", "huge", client=client, token=""))

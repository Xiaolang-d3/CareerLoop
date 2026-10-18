from __future__ import annotations

import copy
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import workspace
from app.api.home import router
from app.feeds import digest, service, sources


NOW = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
ARTICLE = {"id": "article:fixture", "title": "Agent SDK", "summary": "Tools update", "url": "https://openai.com/index/agent", "source": "OpenAI", "published_at": "2026-10-07T12:00:00Z", "category": "Agent", "tags": ["Agent"], "image_url": None}
SECOND_ARTICLE = {**ARTICLE, "id": "article:second", "title": "MCP 更新", "summary": "New transports", "url": "https://openai.com/index/mcp", "published_at": "2026-10-08T06:00:00Z"}
PROFILE_ID = "digest-profile"


def profile_connection(profile_id: str) -> dict:
    return {"profile_id": profile_id, "model_name": "digest-model", "model_base_url": "https://example.test/v1", "model_protocol": "openai", "api_key": "test-key", "parameters": {}, "reasoning_effort": None, "resolved_model_protocol": "openai"}


def digest_json(*sections: dict) -> str:
    return json.dumps({"overview": "今日总览", "sections": list(sections)}, ensure_ascii=False)


@pytest.fixture
def home_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "_now", lambda: NOW)
    monkeypatch.setattr(service, "_running", set())
    monkeypatch.setattr(service, "_last_started", {})
    monkeypatch.setattr(digest, "_running", set())
    monkeypatch.setattr(digest, "_local_date", lambda: "2026-10-08")
    monkeypatch.setattr(digest, "_resolve_connection", profile_connection)
    monkeypatch.setattr(sources, "fetch_source", lambda source: [copy.deepcopy(ARTICLE)] if source.kind == "news" else [])
    with workspace.use_workspace(101, tmp_path / "101") as root:
        yield root


@pytest.fixture
def immediate_threads(monkeypatch):
    monkeypatch.setattr(workspace, "spawn_thread", lambda target, *, args, name: target(*args))


@pytest.fixture
def model_calls(monkeypatch):
    calls: list[str] = []

    def request(connection, prompt):
        calls.append(prompt)
        return digest_json({"key": "news", "points": [{"text": "要点一", "ref": 1}]})

    monkeypatch.setattr(digest, "_request_model", request)
    return calls


def configure(profile_id: str = PROFILE_ID) -> None:
    service.save_preferences(["Agent"], [], profile_id)


def generated_feed() -> dict:
    service.get_feed()
    configure()
    return service.get_feed(refresh_if_due=False)


def test_unconfigured_digest_never_calls_the_model(home_workspace, monkeypatch, model_calls):
    runners = []
    monkeypatch.setattr(workspace, "spawn_thread", lambda target, *, args, name: runners.append((target, args)))
    service.get_feed()
    for target, args in runners:
        target(*args)
    snapshot = service.get_feed(refresh_if_due=False)
    assert snapshot["digest"]["status"] == "unconfigured"
    assert snapshot["digest"]["sections"] == []
    assert model_calls == []
    assert len(runners) == 1


def test_auto_generation_is_cached_for_the_day(home_workspace, immediate_threads, model_calls):
    snapshot = generated_feed()
    digest_block = snapshot["digest"]
    assert digest_block["status"] == "ready"
    assert digest_block["overview"] == "今日总览"
    assert digest_block["model_name"] == "digest-model"
    assert digest_block["sections"][0]["label"] == "AI / Agent 动态"
    assert digest_block["sections"][0]["points"][0] == {"text": "要点一", "url": ARTICLE["url"]}
    assert len(model_calls) == 1
    assert service.get_feed()["digest"]["status"] == "ready"
    assert len(model_calls) == 1


def test_empty_sources_skip_generation_until_content_exists(home_workspace, immediate_threads, model_calls, monkeypatch):
    monkeypatch.setattr(sources, "fetch_source", lambda source: [])
    service.get_feed()
    configure()
    snapshot = service.get_feed()
    assert snapshot["digest"]["status"] == "empty"
    assert model_calls == []
    monkeypatch.setattr(sources, "fetch_source", lambda source: [copy.deepcopy(ARTICLE)] if source.kind == "news" else [])
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(hours=2))
    service.get_feed()
    snapshot = service.get_feed(refresh_if_due=False)
    assert snapshot["digest"]["status"] == "ready"
    assert len(model_calls) == 1


def test_changed_content_marks_stale_without_automatic_repeat_call(home_workspace, immediate_threads, model_calls, monkeypatch):
    generated_feed()
    assert len(model_calls) == 1
    monkeypatch.setattr(sources, "fetch_source", lambda source: [copy.deepcopy(ARTICLE), copy.deepcopy(SECOND_ARTICLE)] if source.kind == "news" else [])
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(hours=2))
    snapshot = service.get_feed()
    assert snapshot["digest"]["status"] == "stale"
    assert snapshot["digest"]["overview"] == "今日总览"
    assert len(model_calls) == 1
    assert digest.regenerate() is True
    refreshed = service.get_feed(refresh_if_due=False)
    assert refreshed["digest"]["status"] == "ready"
    assert len(model_calls) == 2


def test_new_day_regenerates_once(home_workspace, immediate_threads, model_calls, monkeypatch):
    generated_feed()
    assert len(model_calls) == 1
    monkeypatch.setattr(digest, "_local_date", lambda: "2026-10-09")
    service.get_feed()
    assert service.get_feed(refresh_if_due=False)["digest"]["status"] == "ready"
    assert len(model_calls) == 2
    service.get_feed()
    assert len(model_calls) == 2


def test_changing_profile_marks_stale_and_regenerate_uses_new_profile(home_workspace, immediate_threads, model_calls):
    generated_feed()
    configure("another-profile")
    snapshot = service.get_feed(refresh_if_due=False)
    assert snapshot["preferences"]["digest_profile_id"] == "another-profile"
    assert snapshot["digest"]["status"] == "stale"
    assert len(model_calls) == 1
    digest.regenerate()
    assert service.get_feed(refresh_if_due=False)["digest"]["status"] == "ready"


def test_model_failure_keeps_previous_digest_and_reports_error(home_workspace, immediate_threads, model_calls, monkeypatch):
    generated_feed()
    monkeypatch.setattr(digest, "_request_model", lambda connection, prompt: (_ for _ in ()).throw(RuntimeError("upstream")))
    digest.regenerate()
    snapshot = service.get_feed(refresh_if_due=False)
    assert snapshot["digest"]["status"] == "error"
    assert snapshot["digest"]["overview"] == "今日总览"
    assert "日报生成失败" in snapshot["digest"]["error"]


def test_invalid_model_output_is_rejected(home_workspace, immediate_threads, model_calls, monkeypatch):
    monkeypatch.setattr(digest, "_request_model", lambda connection, prompt: "这不是 JSON")
    service.get_feed()
    configure()
    snapshot = service.get_feed(refresh_if_due=False)
    assert snapshot["digest"]["status"] == "error"
    assert "日报" in snapshot["digest"]["error"]
    assert snapshot["digest"]["overview"] == ""


def test_points_are_bounded_and_unknown_refs_have_no_link(home_workspace, immediate_threads, model_calls, monkeypatch):
    points = [{"text": f"要点 {index}", "ref": index} for index in range(1, 7)] + [{"text": "越界", "ref": 99}]
    monkeypatch.setattr(digest, "_request_model", lambda connection, prompt: digest_json({"key": "news", "points": points}, {"key": "unknown", "points": [{"text": "忽略"}]}))
    snapshot = generated_feed()
    digest_sections = snapshot["digest"]["sections"]
    assert [section["key"] for section in digest_sections] == ["news"]
    assert len(digest_sections[0]["points"]) == 4
    monkeypatch.setattr(digest, "_request_model", lambda connection, prompt: digest_json({"key": "news", "points": [{"text": "无链接", "ref": 99}]}))
    digest.regenerate()
    assert service.get_feed(refresh_if_due=False)["digest"]["sections"][0]["points"] == [{"text": "无链接", "url": None}]


def test_preferences_validate_digest_profile(home_workspace, monkeypatch):
    def missing(profile_id: str) -> dict:
        raise ValueError("所选模型或连接已停用")

    monkeypatch.setattr(digest, "_resolve_connection", missing)
    with pytest.raises(ValueError, match="日报模型不可用"):
        service.save_preferences(["Agent"], [], "missing-profile")
    monkeypatch.setattr(digest, "_resolve_connection", profile_connection)
    with pytest.raises(ValueError):
        service.save_preferences(["Agent"], [], "x" * 65)


def test_digest_http_routes(home_workspace, immediate_threads, model_calls, monkeypatch):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        fetched = client.get("/home/feed")
        assert fetched.status_code == 200
        assert fetched.json()["digest"]["status"] == "unconfigured"
        rejected = client.post("/home/feed/digest")
        assert rejected.status_code == 422
        assert "日报模型" in rejected.json()["detail"]
        saved = client.put("/home/preferences", json={"topics": ["Agent"], "repositories": [], "digest_profile_id": PROFILE_ID})
        assert saved.status_code == 200
        assert saved.json()["digest"]["status"] in {"generating", "ready"}
        assert client.get("/home/feed").json()["digest"]["status"] == "ready"
        assert len(model_calls) == 1
        generated = client.post("/home/feed/digest")
        assert generated.status_code == 200
        assert generated.json()["digest"]["status"] in {"generating", "ready"}
        assert client.get("/home/feed").json()["digest"]["status"] == "ready"
        assert len(model_calls) == 2
        unchanged = client.put("/home/preferences", json={"topics": ["Agent"], "repositories": []})
        assert unchanged.status_code == 200
        assert unchanged.json()["preferences"]["digest_profile_id"] == PROFILE_ID


def test_new_day_response_reports_generating_to_start_browser_polling(home_workspace, immediate_threads, model_calls, monkeypatch):
    generated_feed()
    monkeypatch.setattr(digest, "_local_date", lambda: "2026-10-09")
    monkeypatch.setattr(service, "start_refresh", lambda: False)
    monkeypatch.setattr(workspace, "spawn_thread", lambda *args, **kwargs: None)
    snapshot = service.get_feed()
    assert snapshot["digest"]["status"] == "generating"
    assert snapshot["digest"]["overview"] == "今日总览"

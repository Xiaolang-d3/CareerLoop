from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from app import workspace
from app.feeds import service

from app.feeds import curation, digest, sources
from app.research.options import SearchResponse
from app.api.home import router
from fastapi import FastAPI
from fastapi.testclient import TestClient


NOW = datetime(2026, 10, 18, 10, tzinfo=timezone.utc)


@pytest.fixture
def home_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "_now", lambda: NOW)
    monkeypatch.setattr(service, "_running", set())
    monkeypatch.setattr(service, "_last_started", {})
    monkeypatch.setattr(curation, "_running", {})
    with workspace.use_workspace(101, tmp_path / "101") as root:
        yield root


def test_curation_is_opt_in_and_old_caches_remain_readable(home_workspace):
    snapshot = service.get_feed(refresh_if_due=False)
    assert snapshot["curation"]["status"] == "disabled"
    assert snapshot["curation"]["items"] == []
    assert snapshot["preferences"].get("curation_enabled", False) is False
    assert not (home_workspace / "home-feed.json").exists()


ARTICLE = {
    "url": "https://openai.com/index/agent-sdk?utm_source=test",
    "title": "Agent SDK adds resumable workflows",
    "published_at": "2026-10-18T08:00:00Z",
    "content": "On October 18, 2026, Agent SDK added resumable workflows. The new checkpoint API supports recovery after a worker restart.",
    "snippet": "Agent SDK update",
}
EVIDENCE = "Agent SDK added resumable workflows."


@pytest.fixture
def pipeline(monkeypatch):
    calls = {"search": [], "model": [], "results": [dict(ARTICLE)]}

    class SearchClient:
        async def search(self, request):
            calls["search"].append(request)
            if calls.get("fail_search"):
                raise RuntimeError("upstream secret error body")
            return SearchResponse(sources=calls["results"], provider="tavily", requested_topic=request.topic)

        async def enrich_sources(self, items, *, concurrency=1):
            if calls.get("fail_extract"):
                return [{**item, "content": ""} for item in items], [{"message": "private diagnostic"}]
            return items, []

    def model(connection, prompt):
        calls["model"].append(prompt)
        if calls.get("fail_model"):
            raise RuntimeError("secret provider message")
        if "model_result" in calls:
            return calls["model_result"]
        return json.dumps({"items": [{
            "ref": 1, "event_key": "agent-sdk-resumable-workflows", "event_date": "2026-10-18",
            "title": "Agent SDK 支持工作流恢复", "summary": "新增检查点接口。",
            "why_it_matters": "开发长任务 Agent 时可以评估恢复方案。", "score": 85,
            "confidence": "high", "evidence": EVIDENCE,
        }]}, ensure_ascii=False)

    monkeypatch.setattr(curation, "_build_search_client", lambda: SearchClient(), raising=False)
    monkeypatch.setattr(curation, "_request_model", model, raising=False)
    monkeypatch.setattr(curation, "is_public_source_url", lambda url: url.startswith("https://openai.com/"), raising=False)
    monkeypatch.setattr(digest, "_resolve_connection", lambda profile_id: {"profile_id": profile_id, "model_name": "editor-model"})
    monkeypatch.setattr(sources, "fetch_source", lambda source: [])
    monkeypatch.setattr(sources, "fetch_article_published_at", lambda url: None)
    monkeypatch.setattr(workspace, "spawn_thread", lambda target, *, args, name: target(*args))
    return calls


def test_opt_in_discovers_without_rss_and_returns_grounded_picks_cached_for_day(home_workspace, pipeline):
    service.save_preferences(["Agent", "MCP"], [], "editor-profile", curation_enabled=True)
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "ready"
    assert result["model_name"] == "editor-model"
    assert len(result["items"]) == 1
    pick = result["items"][0]
    assert pick["url"] == "https://openai.com/index/agent-sdk"
    assert pick["why_it_matters"] == "开发长任务 Agent 时可以评估恢复方案。"
    assert pick["evidence"] == EVIDENCE
    assert pick["source"] == "openai.com"
    assert pick["published_at"] == ARTICLE["published_at"]
    assert pick["event_date"] == "2026-10-18"
    assert 1 <= len(pipeline["search"]) <= 3
    assert len(pipeline["model"]) == 1
    for request in pipeline["search"]:
        assert "2026-10-18" in request.query
        assert request.count <= 8
    assert "daily-news-curator" in pipeline["model"][0]
    assert "Agent" in pipeline["model"][0]
    search_count = len(pipeline["search"])
    service.get_feed()
    assert len(pipeline["search"]) == search_count
    assert len(pipeline["model"]) == 1


def test_curation_http_opt_in_regenerate_and_disable(home_workspace, pipeline):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        assert client.post("/home/feed/curation").status_code == 422
        missing_model = client.put("/home/preferences", json={"topics": ["Agent"], "repositories": [], "curation_enabled": True})
        assert missing_model.status_code == 422
        assert pipeline["search"] == []
        assert pipeline["model"] == []
        enabled = client.put("/home/preferences", json={"topics": ["Agent"], "repositories": [], "digest_profile_id": "editor", "curation_enabled": True})
        assert enabled.status_code == 200
        assert client.get("/home/feed").json()["curation"]["status"] == "ready"
        assert len(pipeline["model"]) == 1
        assert client.post("/home/feed/curation").status_code == 200
        assert len(pipeline["model"]) == 2
        assert client.put("/home/preferences", json={"topics": ["MCP"], "repositories": []}).json()["preferences"]["curation_enabled"] is True
        assert client.get("/home/feed").json()["curation"]["status"] == "stale"
        disabled = client.put("/home/preferences", json={"topics": ["MCP"], "repositories": [], "curation_enabled": False})
        assert disabled.json()["curation"]["status"] == "disabled"
        assert client.post("/home/feed/curation").status_code == 422
        assert len(pipeline["model"]) == 2


def test_search_failure_is_error_not_empty_keeps_previous_and_does_not_auto_retry(home_workspace, pipeline, monkeypatch):
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    previous = service.get_feed(refresh_if_due=False)["curation"]
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(days=1))
    pipeline["fail_search"] = True
    service.get_feed()
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "error"
    assert "搜索失败" in result["error"]
    assert "secret" not in result["error"]
    assert result["date"] == previous["date"]
    assert result["items"] == previous["items"]
    count = len(pipeline["search"])
    service.get_feed()
    assert len(pipeline["search"]) == count


def test_empty_success_never_fills_with_old_future_or_undated_news(home_workspace, pipeline):
    pipeline["results"] = [{**ARTICLE, "published_at": value} for value in ("2025-01-01", "2027-01-01")]
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "empty"
    assert result["items"] == []
    assert result["model_name"] == ""
    assert pipeline["model"] == []


def test_search_snippets_are_not_presented_as_read_articles(home_workspace, pipeline):
    pipeline["results"] = [{**ARTICLE, "content": ""}]
    pipeline["fail_extract"] = True
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "error"
    assert "原文" in result["error"]
    assert pipeline["model"] == []


def test_missing_dates_are_verified_before_candidate_filtering(home_workspace, pipeline, monkeypatch):
    pipeline["results"] = [{**ARTICLE, "published_at": None}]
    checked = []

    def publication(url):
        checked.append(url)
        return "2026-10-18T08:00:00Z"

    monkeypatch.setattr(sources, "fetch_article_published_at", publication)
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "ready"
    assert len(result["items"]) == 1
    assert result["items"][0]["published_at"] == "2026-10-18T08:00:00Z"
    assert len(checked) == 1


def test_unverifiable_search_dates_are_not_cached_as_no_news(home_workspace, pipeline):
    pipeline["results"] = [{**ARTICLE, "published_at": None}]
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "error"
    assert "发布时间未能核实" in result["error"]
    assert "不代表今天没有" in result["error"]
    assert pipeline["model"] == []


def test_legacy_empty_cache_does_not_invent_a_reason_or_start_paid_retry(home_workspace, pipeline):
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    payload = service._load(home_workspace)
    payload["curation"]["cache"].update(items=[], warnings=["部分候选缺少可核对的发布时间，未纳入今日精选"])
    payload["curation"]["cache"].pop("diagnostics")
    payload["curation"]["cache"].pop("empty_reason")
    service._save(home_workspace, payload)
    calls = len(pipeline["search"])
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "empty"
    assert result["empty_reason"] == ""
    assert result["diagnostics"] is None
    assert result["model_name"] == "editor-model"
    assert result["warnings"]
    assert len(pipeline["search"]) == calls


def test_verified_candidates_declined_by_editor_remain_a_valid_empty_edition(home_workspace, pipeline):
    pipeline["results"].append({**ARTICLE, "url": "https://openai.com/index/undated", "published_at": None})
    pipeline["model_result"] = '{"items":[]}'
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "empty"
    assert result["model_name"] == "editor-model"
    assert result["warnings"]
    assert len(pipeline["model"]) == 1
    assert result["empty_reason"] == "editorial_filter"
    assert result["diagnostics"]["verified_candidates"] == 1
    assert result["diagnostics"]["proposed_items"] == 0


def test_date_recovery_is_bounded_and_only_uses_existing_public_origins(home_workspace, pipeline, monkeypatch):
    pipeline["results"] += [{**ARTICLE, "url": f"https://openai.com/index/undated-{index}", "published_at": None} for index in range(8)]
    pipeline["results"].insert(0, {**ARTICLE, "url": "https://evil.test/metadata", "published_at": None})
    checked = []
    monkeypatch.setattr(sources, "fetch_article_published_at", lambda url: checked.append(url))
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    assert set(checked) == {f"https://openai.com/index/undated-{index}" for index in range(4)}
    assert service.get_feed(refresh_if_due=False)["curation"]["status"] == "ready"


def test_recent_three_days_are_eligible_but_older_and_future_candidates_are_not(home_workspace, pipeline):
    pipeline["results"] = [{**ARTICLE, "published_at": "2026-10-16T08:00:00Z"}]
    pipeline["model_result"] = json.dumps({"items": [{"ref": 1, "event_key": "sdk-release", "event_date": "2026-10-16", "title": "SDK 更新", "summary": "新增恢复接口", "why_it_matters": "支持长任务恢复", "score": 85, "confidence": "high", "evidence": EVIDENCE}]})
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "ready"
    assert result["window_hours"] == 72
    assert result["items"][0]["event_date"] == "2026-10-16"
    candidates, _ = curation._candidates([{**ARTICLE, "published_at": date} for date in ("2026-10-15T09:59:59Z", "2026-10-19T00:00:00Z")], NOW)
    assert candidates == []


def test_model_failure_is_recoverable_and_preserves_cached_picks(home_workspace, pipeline):
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    previous = service.get_feed(refresh_if_due=False)["curation"]
    pipeline["fail_model"] = True
    assert curation.regenerate()
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "error"
    assert "secret" not in result["error"]
    assert result["items"] == previous["items"]
    pipeline["fail_model"] = False
    assert curation.regenerate()
    assert service.get_feed(refresh_if_due=False)["curation"]["status"] == "ready"


def test_invented_evidence_is_rejected_as_model_failure_not_no_news(home_workspace, pipeline):
    pipeline["model_result"] = json.dumps({"items": [{"ref": 1, "event_key": "fake-event", "event_date": "2026-10-18", "title": "伪造", "summary": "没有依据", "why_it_matters": "虚假原因", "score": 100, "confidence": "high", "evidence": "This sentence was never in the original article."}]})
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "error"
    assert result["items"] == []


def test_lost_worker_does_not_leave_infinite_polling(home_workspace, pipeline, monkeypatch):
    monkeypatch.setattr(workspace, "spawn_thread", lambda *args, **kwargs: None)
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    assert service.get_feed(refresh_if_due=False)["curation"]["status"] == "generating"
    curation._running.clear()
    interrupted = service.get_feed(refresh_if_due=False)["curation"]
    assert interrupted["status"] == "error"
    assert "中断" in interrupted["error"]
    monkeypatch.setattr(workspace, "spawn_thread", lambda target, *, args, name: target(*args))
    assert curation.regenerate()
    assert service.get_feed(refresh_if_due=False)["curation"]["status"] == "ready"

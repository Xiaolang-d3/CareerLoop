from __future__ import annotations

import copy
import json
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest

from app.config import Settings
from app.feeds import benchmarks, service, sources
from test_home_feeds_service import NOW, home_workspace, immediate_refresh

KEY = "fixture-aa-key-not-a-secret"


def model(index=1, **overrides):
    return {"id": f"id-{index}", "name": f"Atlas {index} (high)", "slug": f"atlas-{index}",
            "model_creator": {"id": "creator-1", "name": "New Lab"},
            "evaluations": {"artificial_analysis_intelligence_index": 51.2, "artificial_analysis_agentic_index": 49},
            "pricing": {"price_1m_input_tokens": 1.1, "price_1m_output_tokens": 4.4},
            "artificial_analysis_intelligence_index_cost": {"cost_per_task": {"total_cost": 0.25}},
            "performance": {"median_output_tokens_per_second": 153.8, "median_time_to_first_token_seconds": 14.9}, **overrides}


def envelope(data, page=1, total_pages=1, **overrides):
    return {"tier": "free", "intelligence_index_version": 4.3,
            "pagination": {"page": page, "total_pages": total_pages, "has_more": page < total_pages},
            "data": data, **overrides}


def transport(monkeypatch, handler):
    client = httpx.Client
    monkeypatch.setattr("app.config.get_settings", lambda: SimpleNamespace(artificial_analysis_api_key=KEY))
    monkeypatch.setattr(benchmarks.httpx, "Client", lambda **kwargs: client(transport=httpx.MockTransport(handler), **kwargs))


def test_official_request_uses_header_and_preserves_every_configuration(monkeypatch):
    calls = []

    def handler(request):
        calls.append(request)
        page = int(request.url.params["page"])
        # The second page repeats one ID; new models must still be retained.
        return httpx.Response(200, json=envelope([model(index) for index in range(1 if page == 1 else 15, 16 if page == 1 else 31)], page, 2, api_key=KEY))

    transport(monkeypatch, handler)
    rows = benchmarks.fetch()
    assert len(rows) == 30  # Same creator, all configurations: no best-model quota.
    assert rows[0]["task_cost"] == 0.25
    assert rows[0]["agentic"] == 49
    assert rows[0]["tokens_per_second"] == 153.8
    assert rows[0]["first_token_seconds"] == 14.9
    assert rows[0]["input_price"] == 1.1
    assert rows[0]["output_price"] == 4.4
    assert rows[0]["url"] == "https://artificialanalysis.ai/models/atlas-1"
    assert len(calls) == 2
    assert benchmarks.API_URL == "https://artificialanalysis.ai/api/v2/language/models/free"
    assert [request.url.params["page"] for request in calls] == ["1", "2"]
    assert all(str(request.url).split("?")[0] == benchmarks.API_URL and request.headers["x-api-key"] == KEY for request in calls)
    assert KEY not in json.dumps(rows)
    settings = Settings(artificial_analysis_api_key=KEY)
    assert KEY not in repr(settings)
    assert "artificial_analysis_api_key" not in settings.model_dump()


def test_missing_values_stay_null_and_free_prices_stay_zero():
    rows = benchmarks.normalize({"data": [model(pricing={"price_1m_input_tokens": 0}, evaluations={}, artificial_analysis_intelligence_index_cost={}), model(2, pricing={"price_1m_input_tokens": True, "price_1m_output_tokens": -1}, performance={"median_output_tokens_per_second": float("nan")})]})
    assert rows[0]["intelligence"] is None
    assert rows[0]["input_price"] == 0
    assert rows[0]["task_cost"] is None
    assert rows[1]["input_price"] is None
    assert rows[1]["output_price"] is None
    assert rows[1]["tokens_per_second"] is None


@pytest.mark.parametrize("second_page", [
    {"page": 1, "total_pages": 2, "has_more": False},
    {"page": 2, "total_pages": 3, "has_more": True},
    {"page": 2, "total_pages": 2, "has_more": True},
    {"page": 2, "total_pages": 101, "has_more": True},
])
def test_invalid_pagination_never_publishes_partial_models(monkeypatch, second_page):
    def handler(request):
        page = int(request.url.params["page"])
        return httpx.Response(200, json=envelope([model(page)], page, 2, **({"pagination": second_page} if page == 2 else {})))
    transport(monkeypatch, handler)
    with pytest.raises(ValueError, match="分页"):
        benchmarks.fetch()


def test_page_two_failure_does_not_return_only_page_one(monkeypatch):
    transport(monkeypatch, lambda request: httpx.Response(200, json=envelope([model()], 1, 2)) if request.url.params["page"] == "1" else httpx.Response(500))
    with pytest.raises(ValueError, match="暂时无法更新"):
        benchmarks.fetch()


@pytest.mark.parametrize("status", [301, 401, 403, 429, 500])
def test_api_errors_do_not_redirect_or_expose_upstream_bodies(monkeypatch, status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, headers={"Location": "https://evil.test/collect"}, text=f"Upstream echoed {KEY}")

    transport(monkeypatch, handler)
    with pytest.raises(ValueError) as error:
        benchmarks.fetch()
    assert KEY not in str(error.value)
    assert len(calls) == 1


def test_response_size_and_schema_changes_are_rejected(monkeypatch):
    transport(monkeypatch, lambda request: httpx.Response(200, content=b"x" * 100))
    monkeypatch.setattr(benchmarks, "MAX_RESPONSE_BYTES", 50)
    with pytest.raises(ValueError, match="大小限制"):
        benchmarks.fetch()
    for payload in ({"models": []}, {"data": [{}]}, {"status": 401, "data": []}):
        with pytest.raises(ValueError):
            benchmarks.normalize(payload)


def test_missing_key_never_issues_a_request(monkeypatch):
    monkeypatch.setattr("app.config.get_settings", lambda: SimpleNamespace(artificial_analysis_api_key=None))
    monkeypatch.setattr(benchmarks.httpx, "Client", lambda **kwargs: pytest.fail("No request without a key"))
    assert benchmarks.configured() is False
    with pytest.raises(ValueError, match="尚未配置"):
        benchmarks.fetch()


def test_home_keeps_api_snapshot_when_refresh_fails(home_workspace, immediate_refresh, monkeypatch):
    monkeypatch.setattr(benchmarks, "configured", lambda: True)
    rows = benchmarks.normalize({"data": [model()]})
    monkeypatch.setattr(sources, "fetch_source", lambda source: copy.deepcopy(rows) if source.adapter == "aa_api" else [])
    first = service.get_feed()["model_benchmarks"]
    assert first["models"] == rows
    assert first["collected_at"] == "2026-10-08T12:00:00Z"
    with pytest.raises(LookupError):
        service.set_item_state(rows[0]["id"], {"bookmarked": True})
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(hours=7))
    monkeypatch.setattr(sources, "fetch_source", lambda source: (_ for _ in ()).throw(ValueError("官方评测 API 暂时不可用")))
    stale = service.get_feed()["model_benchmarks"]
    assert stale["models"] == rows
    assert stale["status"] == "error"
    assert stale["collected_at"] == first["collected_at"]
    assert KEY not in json.dumps(service.get_feed(refresh_if_due=False))


def test_home_reports_unconfigured_without_requesting_api(home_workspace, immediate_refresh):
    result = service.get_feed()["model_benchmarks"]
    assert result["status"] == "unconfigured"
    assert result["models"] == []

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.domain import ModelResponse
from app.feeds import digest
from app.observability.model_context import current_model_call


CONNECTION = {"model_name": "editor-test", "model_protocol": "responses", "detected_protocol": "responses", "api_key": "fixture-key", "profile_id": "editor-profile", "parameters": {}, "reasoning_effort": None}


@pytest.fixture
def request_path(monkeypatch):
    requests = []

    class Provider:
        async def generate(self, request):
            requests.append(request)
            if request.reasoning_effort is None:
                # Deterministic reproduction: server defaults spend the whole
                # deadline thinking; explicit low effort produces the summary.
                await asyncio.Event().wait()
            return ModelResponse(content='{"overview":"摘要","sections":[]}')

    monkeypatch.setattr("app.config.get_settings", lambda: SimpleNamespace(model_timeout_seconds=0.03))
    monkeypatch.setattr("app.models.build_model_provider", lambda **kwargs: Provider())
    return requests


def test_daily_summary_has_low_effort_default_instead_of_waiting_until_deadline(request_path):
    result = digest._request_model(CONNECTION, "公开资讯摘要")
    assert '"overview"' in result
    assert request_path[0].reasoning_effort == "low"
    assert request_path[0].parameters["max_output_tokens"] == 1200
    assert CONNECTION["reasoning_effort"] is None


@pytest.mark.parametrize("effort", ["low", "medium", "high"])
def test_explicit_profile_reasoning_is_not_overridden(request_path, effort):
    digest._request_model({**CONNECTION, "reasoning_effort": effort}, "公开资讯摘要")
    assert request_path[0].reasoning_effort == effort


def test_outer_deadline_is_recorded_once_with_digest_identity(request_path, monkeypatch):
    events = []

    class SlowProvider:
        async def generate(self, request):
            await asyncio.Event().wait()

    def record(**values):
        events.append({**values, "identity": current_model_call()})

    monkeypatch.setattr("app.models.build_model_provider", lambda **kwargs: SlowProvider())
    monkeypatch.setattr("app.observability.model_monitor.record_model_service_event", record)
    with pytest.raises(TimeoutError):
        digest._request_model(CONNECTION, "公开资讯摘要")
    assert len(events) == 1
    assert events[0]["error_code"] == "request_timeout"
    assert events[0]["latency_ms"] >= 25
    assert events[0]["identity"]["stage"] == "digest"
    assert events[0]["identity"]["profile_id"] == "editor-profile"

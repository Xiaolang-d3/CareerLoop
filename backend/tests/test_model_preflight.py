import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.api import model as resources
from app.models import ModelProviderError


@pytest.mark.parametrize("failure", [None, "invalid_provider_response", "authentication_failed", "request_timeout"])
def test_current_probe_not_historical_health(monkeypatch, failure):
    monkeypatch.setattr(resources, "get_model_connection", lambda: {
        "api_key": "test-only", "model_name": "test", "model_base_url": "",
        "resolved_model_protocol": "openai", "model_protocol": "openai",
    })
    # Opposite historical status must not determine this request's availability.
    monkeypatch.setattr(resources, "get_model_monitor_snapshot", lambda: {"status": "healthy" if failure else "degraded"})
    check = AsyncMock(side_effect=ModelProviderError(failure, "test error") if failure else None)
    monkeypatch.setattr(resources, "build_model_provider", lambda **kwargs: SimpleNamespace(check_connection=check))
    result = asyncio.run(resources.model_monitor_check())
    assert result["available"] is (failure is None)
    assert result["check_error_code"] == failure
    assert result["check_error_message"] == ("test error" if failure else None)
    check.assert_awaited_once()


def test_missing_configuration_does_not_call_provider(monkeypatch):
    monkeypatch.setattr(resources, "get_model_connection", lambda: {
        "api_key": "", "model_name": "test", "model_base_url": "", "resolved_model_protocol": "openai",
    })
    monkeypatch.setattr(resources, "record_model_service_event", lambda **kwargs: None)
    monkeypatch.setattr(resources, "get_model_monitor_snapshot", lambda: {"status": "unknown"})
    monkeypatch.setattr(resources, "build_model_provider", lambda **kwargs: pytest.fail("must not call provider"))
    result = asyncio.run(resources.model_monitor_check())
    assert result["available"] is False
    assert result["check_error_code"] == "not_configured"
    assert result["check_error_message"] == "尚未配置模型服务 API Key"

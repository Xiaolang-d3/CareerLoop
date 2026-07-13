from __future__ import annotations

from functools import lru_cache
from typing import Any

from ..config import get_settings
from ..models import FakeModelProvider, ModelProviderRegistry
from ..platforms import JobPlatformRegistry, MockJobPlatform
from ..tools import SearchJobsTool, ToolRegistry
from .runtime import AgentRuntime


@lru_cache
def _build_components() -> tuple[AgentRuntime, dict[str, Any]]:
    settings = get_settings()

    models = ModelProviderRegistry()
    fake_model = FakeModelProvider()
    models.register(fake_model.name, fake_model)

    platforms = JobPlatformRegistry()
    mock_platform = MockJobPlatform()
    platforms.register(mock_platform.name, mock_platform)

    tools = ToolRegistry()
    tools.register_handler(SearchJobsTool(platforms))

    runtime = AgentRuntime(
        models=models,
        tools=tools,
        model_provider=settings.model_provider,
        platform_name=settings.job_platform,
        max_tool_rounds=settings.model_max_tool_rounds,
    )
    capabilities = {
        "active_model_provider": settings.model_provider,
        "active_model_name": settings.model_name,
        "active_platform": settings.job_platform,
        "model_providers": models.names(),
        "platforms": platforms.names(),
        "tools": tools.names(),
    }
    return runtime, capabilities


@lru_cache
def get_agent_runtime() -> AgentRuntime:
    runtime, _ = _build_components()
    return runtime


@lru_cache
def get_agent_capabilities() -> dict[str, Any]:
    _, capabilities = _build_components()
    return capabilities

from __future__ import annotations

from functools import lru_cache
from typing import Any

from ..config import get_settings
from ..models import ModelProviderRegistry, OpenAICompatibleProvider
from ..platforms import BossJobPlatform, JobPlatformRegistry, MockJobPlatform
from ..repositories import JobRepository
from ..tools import GetJobDetailTool, RankJobsTool, SearchJobsTool, ToolRegistry
from .runtime import AgentRuntime


@lru_cache
def _build_components() -> tuple[AgentRuntime, dict[str, Any], JobPlatformRegistry]:
    settings = get_settings()

    models = ModelProviderRegistry()
    if settings.model_provider != "openai":
        raise ValueError(f"当前不支持模型提供商：{settings.model_provider}")
    if not settings.openai_api_key:
        raise ValueError("MODEL_PROVIDER=openai 时必须配置 OPENAI_API_KEY")
    openai_model = OpenAICompatibleProvider(
        api_key=settings.openai_api_key,
        model=settings.model_name,
        base_url=settings.model_base_url,
        timeout_seconds=settings.model_timeout_seconds,
    )
    models.register(openai_model.name, openai_model)

    platforms = JobPlatformRegistry()
    mock_platform = MockJobPlatform()
    platforms.register(mock_platform.name, mock_platform)
    boss_platform = BossJobPlatform()
    platforms.register(boss_platform.name, boss_platform)

    tools = ToolRegistry()
    tools.register_handler(SearchJobsTool(platforms, JobRepository()))
    tools.register_handler(GetJobDetailTool(platforms))
    tools.register_handler(RankJobsTool())

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
    return runtime, capabilities, platforms


@lru_cache
def get_agent_runtime() -> AgentRuntime:
    runtime, _, _ = _build_components()
    return runtime


@lru_cache
def get_agent_capabilities() -> dict[str, Any]:
    _, capabilities, _ = _build_components()
    return capabilities


def get_job_platform(name: str):
    _, _, platforms = _build_components()
    return platforms.get(name)

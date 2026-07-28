from __future__ import annotations

from functools import lru_cache
from typing import Any

from ..agent_settings import get_model_connection
from ..config import get_settings
from ..models import ModelProviderRegistry, OpenAICompatibleProvider
from ..tools import (
    AnalyzeResumeAgainstJdTool,
    GenerateInterviewAdviceTool,
    GenerateTailoredResumeContentTool,
    SearchResumeEvidenceTool,
    ResearchCompanyTool,
    SearchPublicWebTool,
    ToolRegistry,
)
from .runtime import AgentRuntime


@lru_cache
def _build_components() -> tuple[AgentRuntime, dict[str, Any]]:
    settings = get_settings()
    model_connection = get_model_connection()

    models = ModelProviderRegistry()
    if settings.model_provider != "openai":
        raise ValueError(f"当前不支持模型提供商：{settings.model_provider}")
    if not model_connection["api_key"]:
        raise ValueError("MODEL_PROVIDER=openai 时必须配置 OPENAI_API_KEY")
    openai_model = OpenAICompatibleProvider(
        api_key=model_connection["api_key"],
        model=model_connection["model_name"],
        base_url=model_connection["model_base_url"] or None,
        timeout_seconds=settings.model_timeout_seconds,
    )
    models.register(openai_model.name, openai_model)

    tools = ToolRegistry()
    tools.register_handler(AnalyzeResumeAgainstJdTool())
    tools.register_handler(SearchResumeEvidenceTool())
    tools.register_handler(GenerateTailoredResumeContentTool())
    tools.register_handler(GenerateInterviewAdviceTool())
    # Always expose the read-only definitions so the chat switch can produce a
    # clear configuration error instead of silently falling back to offline chat.
    tools.register_handler(ResearchCompanyTool(settings=settings))
    tools.register_handler(SearchPublicWebTool(settings=settings))

    runtime = AgentRuntime(
        models=models,
        tools=tools,
        model_provider=settings.model_provider,
        platform_name="manual",
        max_tool_rounds=settings.model_max_tool_rounds,
    )
    capabilities = {
        "active_model_provider": settings.model_provider,
        "active_model_name": model_connection["model_name"],
        "active_platform": "manual",
        "model_providers": models.names(),
        "platforms": ["manual"],
        "tools": tools.names(),
        "web_research": {
            "enabled": settings.web_research_enabled,
            "provider": "agent_search" if settings.web_research_enabled else "disabled",
        },
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


def reload_agent_components() -> None:
    _build_components.cache_clear()
    get_agent_runtime.cache_clear()
    get_agent_capabilities.cache_clear()

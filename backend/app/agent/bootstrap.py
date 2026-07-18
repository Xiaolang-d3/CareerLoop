from __future__ import annotations

from functools import lru_cache
from typing import Any

from ..config import get_settings
from ..models import ModelProviderRegistry, OpenAICompatibleProvider
from ..tools import (
    AnalyzeJobTool,
    AnalyzeResumeGapTool,
    GetCandidateContextTool,
    GetJobDetailTool,
    QueueApplicationTool,
    RankJobsTool,
    SearchLocalKnowledgeTool,
    RequestManualJobImportTool,
    SaveGreetingDraftTool,
    ToolRegistry,
    UpdateApplicationStatusTool,
    UpdateJobStatusTool,
)
from .runtime import AgentRuntime


@lru_cache
def _build_components() -> tuple[AgentRuntime, dict[str, Any]]:
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

    tools = ToolRegistry()
    tools.register_handler(GetCandidateContextTool())
    tools.register_handler(RequestManualJobImportTool())
    tools.register_handler(GetJobDetailTool())
    tools.register_handler(RankJobsTool())
    tools.register_handler(AnalyzeJobTool())
    tools.register_handler(AnalyzeResumeGapTool())
    tools.register_handler(SearchLocalKnowledgeTool())
    tools.register_handler(UpdateJobStatusTool())
    tools.register_handler(SaveGreetingDraftTool())
    tools.register_handler(QueueApplicationTool())
    tools.register_handler(UpdateApplicationStatusTool())

    runtime = AgentRuntime(
        models=models,
        tools=tools,
        model_provider=settings.model_provider,
        platform_name="manual",
        max_tool_rounds=settings.model_max_tool_rounds,
    )
    capabilities = {
        "active_model_provider": settings.model_provider,
        "active_model_name": settings.model_name,
        "active_platform": "manual",
        "model_providers": models.names(),
        "platforms": ["manual"],
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

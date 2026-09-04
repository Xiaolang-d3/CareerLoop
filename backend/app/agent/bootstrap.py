from __future__ import annotations

from typing import Any

from .settings import get_model_connection
from ..config import get_settings
from ..models import ModelProviderRegistry, build_model_provider
from ..model_protocol import protocol_requires_api_key
from ..tools import (
    AnalyzeResumeAgainstJdTool,
    AskUserTool,
    GenerateInterviewAdviceTool,
    GenerateTailoredResumeContentTool,
    SearchResumeEvidenceTool,
    ResearchCompanyTool,
    SearchPublicWebTool,
    AnalyzeJobAgainstStrategyTool,
    CompareJobEvaluationsTool,
    CreateJobEvaluationTool,
    GenerateCandidateMaterialTool,
    GetCandidateContextTool,
    GetJobEvaluationTool,
    ProposeCandidateKnowledgeTool,
    RecordInterviewDebriefTool,
    ReviewJobEvaluationTool,
    SearchCandidateEvidenceTool,
    StartProfileInterviewTool,
    RecordProfileInterviewAnswerTool,
    PauseProfileInterviewTool,
    ToolRegistry,
)
from .runtime import AgentRuntime
from .run_store import AgentRunStore
from ..workspace import current_user_id


_components: dict[tuple[Any, ...], tuple[AgentRuntime, dict[str, Any]]] = {}


def _runtime_cache_key() -> tuple[Any, ...]:
    connection = get_model_connection()
    return (
        current_user_id(),
        connection["model_name"],
        connection["model_base_url"],
        connection.get("model_protocol", "auto"),
        connection["api_key"],
    )


def _build_components() -> tuple[AgentRuntime, dict[str, Any]]:
    settings = get_settings()
    model_connection = get_model_connection()

    models = ModelProviderRegistry()
    if (
        protocol_requires_api_key(model_connection.get("resolved_model_protocol", "openai"))
        and not model_connection["api_key"]
    ):
        raise ValueError("必须先配置模型服务 API Key")
    model = build_model_provider(
        api_key=model_connection["api_key"],
        model=model_connection["model_name"],
        base_url=model_connection["model_base_url"] or None,
        timeout_seconds=settings.model_timeout_seconds,
        protocol=model_connection.get("model_protocol", "auto"),
    )
    models.register(model.name, model)

    tools = ToolRegistry()
    tools.register_handler(AnalyzeResumeAgainstJdTool())
    tools.register_handler(AskUserTool())
    tools.register_handler(SearchResumeEvidenceTool())
    tools.register_handler(GenerateTailoredResumeContentTool())
    tools.register_handler(GenerateInterviewAdviceTool())
    # Always expose the read-only definitions so the chat switch can produce a
    # clear configuration error instead of silently falling back to offline chat.
    tools.register_handler(ResearchCompanyTool(settings=settings))
    tools.register_handler(SearchPublicWebTool(settings=settings))
    tools.register_handler(GetCandidateContextTool())
    tools.register_handler(SearchCandidateEvidenceTool())
    tools.register_handler(ProposeCandidateKnowledgeTool())
    tools.register_handler(StartProfileInterviewTool())
    tools.register_handler(RecordProfileInterviewAnswerTool())
    tools.register_handler(PauseProfileInterviewTool())
    tools.register_handler(AnalyzeJobAgainstStrategyTool())
    tools.register_handler(GenerateCandidateMaterialTool())
    tools.register_handler(RecordInterviewDebriefTool())
    tools.register_handler(CreateJobEvaluationTool())
    tools.register_handler(GetJobEvaluationTool())
    tools.register_handler(ReviewJobEvaluationTool())
    tools.register_handler(CompareJobEvaluationsTool())

    runtime = AgentRuntime(
        models=models,
        tools=tools,
        model_provider=model.name,
        platform_name="manual",
        max_tool_rounds=settings.model_max_tool_rounds,
        tool_timeout_seconds=settings.tool_execution_timeout_seconds,
        max_model_retries=settings.model_retry_attempts,
        max_tool_retries=settings.tool_retry_attempts,
        run_store=AgentRunStore(),
    )
    capabilities = {
        "active_model_provider": model.name,
        "active_model_name": model_connection["model_name"],
        "active_platform": "manual",
        "model_providers": models.names(),
        "platforms": ["manual"],
        "tools": tools.names(),
        "tool_specs": [spec.model_dump(mode="json") for spec in tools.specs()],
        "runtime": {
            "max_tool_rounds": settings.model_max_tool_rounds,
            "model_retry_attempts": settings.model_retry_attempts,
            "tool_retry_attempts": settings.tool_retry_attempts,
            "tool_timeout_seconds": settings.tool_execution_timeout_seconds,
        },
        "web_research": {
            "enabled": settings.web_research_enabled,
            "provider": "agent_search" if settings.web_research_enabled else "disabled",
        },
    }
    return runtime, capabilities


def _cached_components() -> tuple[AgentRuntime, dict[str, Any]]:
    key = _runtime_cache_key()
    cached = _components.get(key)
    if cached is None:
        cached = _build_components()
        _components[key] = cached
    return cached


def get_agent_runtime() -> AgentRuntime:
    runtime, _ = _cached_components()
    return runtime


def get_agent_capabilities() -> dict[str, Any]:
    _, capabilities = _cached_components()
    return capabilities


def reload_agent_components() -> None:
    user_id = current_user_id()
    if user_id is None:
        _components.clear()
        return
    for key in [item for item in _components if item[0] == user_id]:
        del _components[key]


get_agent_runtime.cache_clear = reload_agent_components
get_agent_capabilities.cache_clear = reload_agent_components

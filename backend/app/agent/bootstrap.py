from __future__ import annotations

from typing import Any

from .model_binding import internal_model_selection
from ..observability.model_context import public_model_selection
from ..config import get_settings
from ..models import ModelProviderRegistry, build_model_provider
from ..model_protocol import protocol_requires_api_key
from ..tools import AskUserTool, SearchPublicWebTool, ToolRegistry
from ..tools.library import GetLibraryContextTool, SearchLibraryTool, ProposeLibraryKnowledgeTool
from .runtime import AgentRuntime
from .run_store import AgentRunStore
from ..workspace import current_user_id


_components: dict[tuple[Any, ...], tuple[AgentRuntime, dict[str, Any]]] = {}

SETUP_MESSAGE = "必须先在设置中配置模型服务 API Key 后才能使用对话 Agent"


def get_profile_connection(profile_id: str | None = None, *, selection: dict[str, Any] | None = None) -> dict[str, Any]:
    from .model_catalog import get_profile_connection as resolve_profile

    return resolve_profile(profile_id, selection=selection)


def _runtime_cache_key(connection: dict[str, Any]) -> tuple[Any, ...]:
    return (
        current_user_id(), connection.get("profile_id"), connection.get("profile_revision"),
        connection.get("connection_id"), connection.get("connection_revision"),
        connection["model_name"], connection["model_base_url"], connection.get("model_protocol", "auto"),
    )


def _model_is_configured(model_connection: dict[str, Any]) -> bool:
    protocol = model_connection.get("resolved_model_protocol", "openai")
    if not protocol_requires_api_key(protocol):
        return True
    return bool(model_connection.get("api_key"))


def _build_tool_registry(settings: Any) -> ToolRegistry:
    tools = ToolRegistry()
    tools.register_handler(AskUserTool())
    tools.register_handler(SearchPublicWebTool(settings=settings))
    tools.register_handler(GetLibraryContextTool())
    tools.register_handler(SearchLibraryTool())
    tools.register_handler(ProposeLibraryKnowledgeTool())
    return tools


def _capabilities_payload(
    *,
    settings: Any,
    model_connection: dict[str, Any],
    tools: ToolRegistry,
    model_providers: list[str],
    active_model_provider: str,
    configured: bool,
    setup_message: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "configured": configured,
        "active_model_provider": active_model_provider,
        "active_model_name": model_connection["model_name"],
        "model_selection": public_model_selection(model_connection),
        "active_platform": "manual",
        "model_providers": model_providers,
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
    if setup_message:
        payload["setup_message"] = setup_message
    return payload


def _build_unconfigured_capabilities(model_connection: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    tools = _build_tool_registry(settings)
    return _capabilities_payload(
        settings=settings,
        model_connection=model_connection,
        tools=tools,
        model_providers=[],
        active_model_provider="",
        configured=False,
        setup_message=SETUP_MESSAGE,
    )


def _build_components(model_connection: dict[str, Any]) -> tuple[AgentRuntime, dict[str, Any]]:
    from ..models.configured import configure_model_provider

    settings = get_settings()

    if not _model_is_configured(model_connection):
        raise ValueError("必须先配置模型服务 API Key")

    models = ModelProviderRegistry()
    model = build_model_provider(
        api_key=model_connection["api_key"],
        model=model_connection["model_name"],
        base_url=model_connection["model_base_url"] or None,
        timeout_seconds=settings.model_timeout_seconds,
        protocol=model_connection.get("model_protocol", "auto"),
    )
    model = configure_model_provider(model, model_connection.get("parameters", {}))
    model_alias = str(model_connection.get("profile_id") or model.name)
    models.register(model_alias, model)

    tools = _build_tool_registry(settings)

    runtime = AgentRuntime(
        models=models,
        tools=tools,
        model_provider=model_alias,
        model_selection=internal_model_selection(model_connection),
        platform_name="manual",
        max_tool_rounds=settings.model_max_tool_rounds,
        tool_timeout_seconds=settings.tool_execution_timeout_seconds,
        max_model_retries=settings.model_retry_attempts,
        max_tool_retries=settings.tool_retry_attempts,
        run_store=AgentRunStore(),
    )
    capabilities = _capabilities_payload(
        settings=settings,
        model_connection=model_connection,
        tools=tools,
        model_providers=models.names(),
        active_model_provider=model_alias,
        configured=True,
    )
    return runtime, capabilities


def _cached_components(model_connection: dict[str, Any]) -> tuple[AgentRuntime, dict[str, Any]]:
    key = _runtime_cache_key(model_connection)
    cached = _components.get(key)
    if cached is None:
        cached = _build_components(model_connection)
        _components[key] = cached
    return cached


def get_agent_runtime(profile_id: str | None = None, *, selection: dict[str, Any] | None = None) -> AgentRuntime:
    # Resolve exactly once, before caching; restoring never consults a mutable default.
    connection = get_profile_connection(profile_id, selection=selection)
    runtime, _ = _cached_components(connection)
    return runtime


def get_agent_capabilities() -> dict[str, Any]:
    model_connection = get_profile_connection()
    if not _model_is_configured(model_connection):
        return _build_unconfigured_capabilities(model_connection)
    _, capabilities = _cached_components(model_connection)
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

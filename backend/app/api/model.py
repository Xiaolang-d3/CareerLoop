from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException
from ..agent import get_agent_capabilities
from ..agent.bootstrap import reload_agent_components
from ..agent.model_capabilities import build_model_list, infer_model_capabilities
from ..agent.settings import get_agent_settings, get_model_connection, save_agent_settings
from ..secret_store import SecretStoreUnavailable
from ..agent.operations import get_agent_operations_snapshot
from ..config import get_settings
from ..observability.model_monitor import get_model_monitor_snapshot, record_model_service_event
from ..models import ModelProviderError, OpenAICompatibleProvider, build_model_provider
from ..model_protocol import protocol_requires_api_key, resolve_model_protocol
from .schemas import AgentSettingsIn, ModelCapabilitiesIn, ModelDiscoveryIn


router = APIRouter()


@router.get("/agent/capabilities")
def agent_capabilities() -> dict[str, Any]:
    return get_agent_capabilities()


@router.get("/agent/settings")
def agent_settings_get() -> dict[str, Any]:
    return get_agent_settings()


@router.put("/agent/settings")
def agent_settings_put(payload: AgentSettingsIn) -> dict[str, Any]:
    try:
        saved = save_agent_settings(payload.model_dump())
    except SecretStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    reload_agent_components()
    return saved


@router.post("/agent/models/discover")
async def discover_models(payload: ModelDiscoveryIn) -> dict[str, Any]:
    connection = get_model_connection()
    api_key = payload.api_key.strip() or connection["api_key"]
    base_url = payload.model_base_url.strip()
    model_name = payload.model_name.strip() or connection["model_name"]
    model_protocol = payload.model_protocol or connection.get("model_protocol", "auto")
    resolved_protocol = resolve_model_protocol(model_name, model_protocol, base_url)
    if protocol_requires_api_key(resolved_protocol) and not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")

    provider = build_model_provider(
        api_key=api_key,
        model=model_name,
        base_url=base_url or None,
        timeout_seconds=min(get_settings().model_timeout_seconds, 20),
        protocol=model_protocol,
    )
    try:
        models = await provider.list_models()
    except ModelProviderError as exc:
        raise HTTPException(
            status_code=503 if exc.retryable else 400,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        # 识别模型是配置类操作，未预期异常也要给出可读原因，不能冒泡成 500。
        raise HTTPException(
            status_code=502,
            detail=(
                f"读取模型目录 {provider.models_url} 时发生未预期异常，"
                "请确认 Base URL 与 API Key 后重试"
            ),
        ) from exc
    if not models:
        raise HTTPException(
            status_code=404,
            detail=(
                f"服务已连接，但 {provider.models_url} 没有返回可用模型；"
                "请继续手动填写模型名称"
            ),
        )
    provider_name = provider.name
    normalized_base = base_url.rstrip("/")
    return {
        "models": models,
        "count": len(models),
        "base_url": normalized_base,
        "provider": provider_name,
        "protocol": provider_name,
        "items": build_model_list(
            connection["model_name"],
            models,
            provider=provider_name,
            base_url=normalized_base,
        ),
    }


@router.get("/agent/models/capabilities")
def model_capabilities_get(model_name: str = "") -> dict[str, Any]:
    connection = get_model_connection()
    settings = get_settings()
    return infer_model_capabilities(
        model_name.strip() or connection["model_name"],
        provider=connection.get("resolved_model_protocol", "openai"),
        base_url=connection["model_base_url"],
        protocol=connection.get("model_protocol", "auto"),
    )


@router.post("/agent/models/capabilities")
async def model_capabilities_probe(payload: ModelCapabilitiesIn) -> dict[str, Any]:
    connection = get_model_connection()
    settings = get_settings()
    model_name = payload.model_name.strip() or connection["model_name"]
    base_url = payload.model_base_url.strip() or connection["model_base_url"]
    model_protocol = payload.model_protocol or connection.get("model_protocol", "auto")
    resolved_protocol = resolve_model_protocol(model_name, model_protocol, base_url)
    report = infer_model_capabilities(
        model_name,
        provider=resolved_protocol,
        base_url=base_url,
        protocol=model_protocol,
    )
    if not payload.probe:
        return report

    api_key = payload.api_key.strip() or connection["api_key"]
    if protocol_requires_api_key(resolved_protocol) and not api_key:
        report["probe_error"] = "请先填写或保存 API Key"
        return report

    provider = build_model_provider(
        api_key=api_key,
        model=model_name,
        base_url=base_url or None,
        timeout_seconds=min(settings.model_timeout_seconds, 20),
        protocol=model_protocol,
    )
    try:
        report["vision"] = await provider.probe_vision()
        report["probed"] = True
        report["probe_error"] = None
    except ModelProviderError as exc:
        report["probed"] = False
        report["probe_error"] = str(exc)
    return report


@router.get("/agent/model-monitor")
def model_monitor_get(hours: int = 24) -> dict[str, Any]:
    return get_model_monitor_snapshot(hours)


@router.get("/agent/operations")
def agent_operations_get(days: int = 7, limit: int = 20) -> dict[str, Any]:
    try:
        return get_agent_operations_snapshot(days=days, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/agent/model-monitor/check")
async def model_monitor_check() -> dict[str, Any]:
    connection = get_model_connection()
    if (
        protocol_requires_api_key(connection.get("resolved_model_protocol", "openai"))
        and not connection["api_key"]
    ):
        error_message = "尚未配置模型服务 API Key"
        record_model_service_event(
            request_kind="health_check",
            status="error",
            error_code="not_configured",
            error_message=error_message,
            latency_ms=0,
            model_name=connection["model_name"],
            base_url=OpenAICompatibleProvider._normalize_base_url(
                connection["model_base_url"]
            ),
            protocol=connection.get("resolved_model_protocol", "openai"),
        )
        return {
            **get_model_monitor_snapshot(),
            "available": False,
            "check_error_code": "not_configured",
            "check_error_message": error_message,
        }

    provider = build_model_provider(
        api_key=connection["api_key"],
        model=connection["model_name"],
        base_url=connection["model_base_url"] or None,
        timeout_seconds=get_settings().model_timeout_seconds,
        protocol=connection.get("model_protocol", "auto"),
    )
    available = False
    check_error_code: str | None = None
    check_error_message: str | None = None
    try:
        await provider.check_connection()
        available = True
    except ModelProviderError as exc:
        # The provider already stored a classified failure without prompt content.
        check_error_code = exc.code
        check_error_message = str(exc)
    except Exception:
        check_error_code = "provider_error"
        check_error_message = "主动检测发生未知异常"
        record_model_service_event(
            request_kind="health_check",
            status="error",
            error_code="provider_error",
            error_message=check_error_message,
            latency_ms=0,
            model_name=connection["model_name"],
            base_url=OpenAICompatibleProvider._normalize_base_url(
                connection["model_base_url"]
            ),
            protocol=connection.get("resolved_model_protocol", "openai"),
        )
    return {
        **get_model_monitor_snapshot(),
        "available": available,
        "check_error_code": check_error_code,
        "check_error_message": check_error_message,
    }

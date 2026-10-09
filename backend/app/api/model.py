from __future__ import annotations

import asyncio
from typing import Any
from fastapi import APIRouter, HTTPException
from ..agent import get_agent_capabilities
from ..agent.bootstrap import reload_agent_components
from ..agent.model_capabilities import apply_actual_protocol, build_model_list, infer_model_capabilities
from ..agent.settings import AgentSettingsConflict, get_agent_settings, get_model_connection, save_agent_settings
from ..model_connection import resolve_model_connection
from ..models.auto_negotiating import get_negotiated_model_protocol
from ..secret_store import SecretStoreUnavailable
from ..agent.operations import get_agent_operations_snapshot
from ..config import get_settings
from ..db import connect
from ..observability.model_monitor import get_model_monitor_snapshot, record_model_service_event
from ..observability.model_context import model_call_scope
from ..models import ModelProviderError, OpenAICompatibleProvider, build_model_provider
from ..model_protocol import connection_protocol_label, normalize_model_protocol, protocol_requires_api_key
from .schemas import AgentSettingsIn, ModelCapabilitiesIn, ModelDiscoveryIn
from .model_contracts import ConnectionCreateIn, ConnectionUpdateIn, DefaultProfileIn, ProfileCreateIn, ProfileUpdateIn


router = APIRouter()


def _suggested_protocol(connection: dict[str, Any], error_code: str | None) -> str | None:
    """Machine-readable hint: an explicit Chat Completions connection was rejected."""
    if error_code == "protocol_unsupported" and normalize_model_protocol(connection.get("model_protocol")) == "openai":
        return "responses"
    return None


def _same_saved_connection(connection: dict[str, Any], saved: dict[str, Any]) -> bool:
    """A draft only reuses/records detection when it targets the saved wire identity."""
    return all(connection.get(key) == saved.get(key) for key in ("model_base_url", "model_protocol", "api_key"))


def _provider_for(connection: dict[str, Any], timeout_seconds: float, *, remember: bool = True):
    from ..agent.model_catalog import detected_protocol_recorder

    if not remember:
        connection = {**connection, "detected_protocol": None, "connection_id": ""}
    return build_model_provider(
        api_key=connection["api_key"],
        model=connection["model_name"],
        base_url=connection["model_base_url"] or None,
        timeout_seconds=timeout_seconds,
        protocol=connection.get("model_protocol", "auto"),
        detected_protocol=connection.get("detected_protocol"),
        on_protocol_detected=detected_protocol_recorder(connection),
    )


def _diagnostic_timeout() -> float:
    # A total budget covers protocol negotiation and SDK retries as well.
    return min(get_settings().model_timeout_seconds, 25)


@router.get("/agent/capabilities")
def agent_capabilities() -> dict[str, Any]:
    return get_agent_capabilities()


@router.get("/agent/settings")
def agent_settings_get() -> dict[str, Any]:
    return get_agent_settings()


@router.put("/agent/settings")
def agent_settings_put(payload: AgentSettingsIn) -> dict[str, Any]:
    try:
        saved = save_agent_settings(payload.model_dump(exclude_unset=True))
    except SecretStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AgentSettingsConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    reload_agent_components()
    return saved


@router.get("/agent/settings/requests/{request_id}")
def agent_settings_request_get(request_id: str) -> dict[str, Any]:
    if not request_id or len(request_id) > 120:
        raise HTTPException(status_code=400, detail="保存请求 ID 格式不正确")
    with connect() as conn:
        row = conn.execute(
            "SELECT saved_revision FROM model_settings_requests WHERE request_id = ?", (request_id,),
        ).fetchone()
    # A missing receipt says only that no commit was visible at this instant.
    # The browser must not interpret it as cancellation or automatic rollback.
    return {
        "committed": row is not None,
        "saved_revision": int(row["saved_revision"]) if row else None,
        "settings": get_agent_settings(),
    }


def _catalog_mutation(operation, *args) -> dict[str, Any]:
    from ..agent.model_catalog import get_model_catalog

    try:
        operation(*args)
        reload_agent_components()
        return get_model_catalog()
    except AgentSettingsConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SecretStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/agent/model-connections")
def model_connections_get() -> dict[str, Any]:
    from ..agent.model_catalog import get_model_catalog

    return get_model_catalog()


@router.post("/agent/model-connections")
def model_connections_create(payload: ConnectionCreateIn) -> dict[str, Any]:
    from ..agent.model_catalog import create_model_connection

    return _catalog_mutation(create_model_connection, payload.model_dump(exclude_unset=True))


@router.patch("/agent/model-connections/{connection_id}")
def model_connections_update(connection_id: str, payload: ConnectionUpdateIn) -> dict[str, Any]:
    from ..agent.model_catalog import update_model_connection

    return _catalog_mutation(update_model_connection, connection_id, payload.model_dump(exclude_unset=True))


@router.delete("/agent/model-connections/{connection_id}")
def model_connections_archive(connection_id: str) -> dict[str, Any]:
    from ..agent.model_catalog import archive_model_connection

    return _catalog_mutation(archive_model_connection, connection_id)


@router.post("/agent/model-profiles")
def model_profiles_create(payload: ProfileCreateIn) -> dict[str, Any]:
    from ..agent.model_catalog import add_model_profile

    return _catalog_mutation(add_model_profile, payload.model_dump(exclude_unset=True))


@router.patch("/agent/model-profiles/{profile_id}")
def model_profiles_update(profile_id: str, payload: ProfileUpdateIn) -> dict[str, Any]:
    from ..agent.model_catalog import update_model_profile

    return _catalog_mutation(update_model_profile, profile_id, payload.model_dump(exclude_unset=True))


@router.post("/agent/model-default")
def model_profiles_default(payload: DefaultProfileIn) -> dict[str, Any]:
    from ..agent.model_catalog import set_default_model_profile

    return _catalog_mutation(set_default_model_profile, payload.profile_id)


def _profile_for_connection(connection_id: str) -> dict[str, Any]:
    from ..agent.model_catalog import get_model_catalog, get_profile_connection

    catalog = get_model_catalog()
    profiles = [profile for profile in catalog["profiles"] if profile["connection_id"] == connection_id and profile["enabled"]]
    if not profiles:
        raise HTTPException(status_code=400, detail="连接没有启用的模型档案")
    profile = next((item for item in profiles if item["id"] == catalog["default_profile_id"]), profiles[0])
    try:
        return get_profile_connection(profile["id"])
    except SecretStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/agent/model-connections/{connection_id}/discover")
async def model_connection_discover(connection_id: str) -> dict[str, Any]:
    connection = _profile_for_connection(connection_id)
    return await _discover_connection(connection)


@router.post("/agent/model-connections/{connection_id}/check")
async def model_connection_check(connection_id: str) -> dict[str, Any]:
    connection = _profile_for_connection(connection_id)
    return await _check_connection(connection)


@router.post("/agent/models/discover")
async def discover_models(payload: ModelDiscoveryIn) -> dict[str, Any]:
    saved = get_model_connection()
    try:
        connection = resolve_model_connection(payload.model_dump(exclude_unset=True), saved=saved)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await _discover_connection(connection, remember=_same_saved_connection(connection, saved))


async def _discover_connection(connection: dict[str, Any], *, remember: bool = True) -> dict[str, Any]:
    api_key = connection["api_key"]
    base_url = connection["model_base_url"]
    model_name = connection["model_name"]
    model_protocol = connection["model_protocol"]
    resolved_protocol = connection["resolved_model_protocol"]
    if protocol_requires_api_key(resolved_protocol) and not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")

    provider = _provider_for(connection, min(get_settings().model_timeout_seconds, 20), remember=remember)
    try:
        with model_call_scope(connection, stage="discover"):
            async with asyncio.timeout(_diagnostic_timeout()):
                models = await provider.list_models()
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="读取模型列表超时，请重试或手动填写模型名称") from exc
    except ModelProviderError as exc:
        suggested = _suggested_protocol(connection, exc.code)
        raise HTTPException(
            status_code=503 if exc.retryable else 400,
            detail={"message": str(exc), "code": exc.code, "suggested_protocol": suggested} if suggested else str(exc),
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
    report = infer_model_capabilities(
        model_name.strip() or connection["model_name"],
        provider=connection.get("resolved_model_protocol", "openai"),
        base_url=connection["model_base_url"],
        protocol=connection.get("model_protocol", "auto"),
        actual_protocol=get_negotiated_model_protocol(
            model_name.strip() or connection["model_name"],
            connection.get("model_protocol", "auto"),
            connection["model_base_url"], connection["api_key"],
        ) or (connection.get("detected_protocol") if not model_name.strip() or model_name.strip() == connection["model_name"] else None),
    )
    report["protocol_label"] = connection_protocol_label(
        connection.get("model_protocol", "auto"), report.get("actual_protocol"), report["model_name"], connection["model_base_url"],
    )
    return {**report, "connection_id": connection.get("connection_id", ""),
            "config_revision": connection.get("config_revision", 0)}


@router.post("/agent/models/capabilities")
async def model_capabilities_probe(payload: ModelCapabilitiesIn) -> dict[str, Any]:
    saved = get_model_connection()
    try:
        connection = resolve_model_connection(payload.model_dump(exclude_unset=True), saved=saved)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    remember = _same_saved_connection(connection, saved)
    settings = get_settings()
    model_name = connection["model_name"]
    base_url = connection["model_base_url"]
    model_protocol = connection["model_protocol"]
    resolved_protocol = connection["resolved_model_protocol"]
    report = infer_model_capabilities(
        model_name,
        provider=resolved_protocol,
        base_url=base_url,
        protocol=model_protocol,
    )
    report.update(connection_id=connection.get("connection_id", ""),
                  config_revision=connection.get("config_revision", 0))
    if not payload.probe:
        return report

    api_key = connection["api_key"]
    if protocol_requires_api_key(resolved_protocol) and not api_key:
        report["probe_error"] = "请先填写或保存 API Key"
        return report

    provider = _provider_for(connection, min(settings.model_timeout_seconds, 20), remember=remember)
    try:
        with model_call_scope(connection, stage="vision_probe"):
            async with asyncio.timeout(_diagnostic_timeout()):
                report["vision"] = await provider.probe_vision()
        apply_actual_protocol(report, provider.name, base_url)
        report["protocol_label"] = connection_protocol_label(model_protocol, provider.name, model_name, base_url)
        report["probed"] = True
        report["probe_error"] = None
    except TimeoutError:
        report["probed"] = False
        report["probe_error"] = "图片输入检测超时，请重试"
    except ModelProviderError as exc:
        report["probed"] = False
        report["probe_error"] = str(exc)
    except Exception:
        report["probed"] = False
        report["probe_error"] = "图片输入检测失败，请确认服务配置后重试"
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
    return await _check_connection(connection)


async def _check_connection(connection: dict[str, Any]) -> dict[str, Any]:
    with model_call_scope(connection, stage="health_check"):
        return await _check_scoped_connection(connection)


def _monitor_for_connection(connection: dict[str, Any]) -> dict[str, Any]:
    if connection.get("profile_id"):
        return get_model_monitor_snapshot(connection=connection)
    return get_model_monitor_snapshot()


async def _check_scoped_connection(connection: dict[str, Any]) -> dict[str, Any]:
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
            base_url=connection["model_base_url"],
            protocol=connection.get("resolved_model_protocol", "openai"),
        )
        return {
            **_monitor_for_connection(connection),
            "available": False,
            "connection_id": connection.get("connection_id", ""),
            "config_revision": connection.get("config_revision", 0),
            "check_error_code": "not_configured",
            "check_error_message": error_message,
        }

    provider = _provider_for(connection, get_settings().model_timeout_seconds)
    available = False
    check_error_code: str | None = None
    check_error_message: str | None = None
    try:
        async with asyncio.timeout(_diagnostic_timeout()):
            await provider.check_connection()
        available = True
    except TimeoutError:
        check_error_code = "request_timeout"
        check_error_message = "连接检测超时，请稍后重试"
        record_model_service_event(
            request_kind="health_check", status="error", error_code=check_error_code,
            error_message=check_error_message, latency_ms=round(_diagnostic_timeout() * 1000),
            model_name=connection["model_name"], base_url=connection["model_base_url"],
            protocol=provider.name,
        )
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
            base_url=connection["model_base_url"],
            protocol=connection.get("resolved_model_protocol", "openai"),
        )
    return {
        **_monitor_for_connection(connection),
        "available": available,
        "connection_id": connection.get("connection_id", ""),
        "config_revision": connection.get("config_revision", 0),
        "check_error_code": check_error_code,
        "check_error_message": check_error_message,
        "suggested_protocol": _suggested_protocol(connection, check_error_code),
    }

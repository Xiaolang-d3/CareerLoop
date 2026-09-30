from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from ..agent import get_agent_capabilities
from ..agent.bootstrap import reload_agent_components
from ..agent.model_capabilities import (
    build_model_list,
    infer_model_capabilities,
)
from ..agent.settings import (
    get_agent_settings,
    get_model_connection,
    save_agent_settings,
)
from ..secret_store import SecretStoreUnavailable
from ..agent.operations import get_agent_operations_snapshot
from ..attachments.service import (
    create_attachment,
    delete_attachment,
    delete_conversation_attachments,
    list_attachments,
    parse_attachment,
)
from ..config import get_settings
from ..agent.snapshots import clear_run_snapshot
from ..chat.conversations import (
    create_conversation,
    delete_conversation,
    list_conversations,
    reset_conversation_context,
    update_conversation,
)
from ..db import connect
from ..profile.candidate_core import clear_candidate_resume, create_or_update_profile, list_facts, merge_facts, propose_fact, review_fact
from ..profile.library_sources import (
    create_text_source,
    delete_source,
    get_source,
    get_source_file,
    import_file_source,
    list_sources,
    update_source,
)
from ..observability.model_monitor import get_model_monitor_snapshot, record_model_service_event
from ..models import ModelProviderError, OpenAICompatibleProvider, build_model_provider
from ..model_protocol import protocol_requires_api_key, resolve_model_protocol
from ..profile.library import get_library
from ..profile import service as profile_service
from .dependencies import require_conversation
from .schemas import AgentSettingsIn, CandidateFactIn, CandidateFactMergeIn, CandidateFactReviewIn, LibrarySourceIn, LibrarySourceUpdateIn, CareerProfileInitIn, ConversationIn, ConversationUpdate, ModelCapabilitiesIn, ModelDiscoveryIn, PrivacyScanIn


router = APIRouter()


@router.get("/conversations")
def conversations_index() -> list[dict[str, Any]]:
    return list_conversations()


@router.post("/conversations")
def conversations_create(payload: ConversationIn) -> dict[str, Any]:
    return create_conversation(payload.title)


@router.patch("/conversations/{conversation_id}")
def conversations_update(
    conversation_id: int,
    payload: ConversationUpdate,
) -> dict[str, Any]:
    require_conversation(conversation_id)
    return update_conversation(
        conversation_id,
        title=payload.title,
        status=payload.status,
    )


@router.delete("/conversations/{conversation_id}")
def conversations_delete(conversation_id: int) -> dict[str, Any]:
    require_conversation(conversation_id)
    try:
        delete_conversation_attachments(conversation_id)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"对话附件清理失败，已保留对话记录：{exc}",
        ) from exc
    clear_run_snapshot(conversation_id)
    if not delete_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="对话不存在")
    with connect() as conn:
        conn.execute(
            "DELETE FROM workflow_runs WHERE name = ?",
            (f"conversation-{conversation_id}",),
        )
    remaining = list_conversations()
    if not remaining:
        remaining = [create_conversation()]
    return {"deleted": True, "next_conversation": remaining[0]}


@router.post("/conversations/{conversation_id}/context/reset")
def conversation_context_reset(conversation_id: int) -> dict[str, Any]:
    require_conversation(conversation_id)
    conversation = reset_conversation_context(conversation_id)
    return {
        "reset": True,
        "context_cutoff_message_id": conversation["context_cutoff_message_id"],
        "conversation": conversation,
    }


@router.get("/conversations/{conversation_id}/attachments")
def conversation_attachments(conversation_id: int) -> list[dict[str, Any]]:
    require_conversation(conversation_id)
    return list_attachments(conversation_id)


@router.post("/attachments")
async def attachments_upload(
    conversation_id: int = Form(...),
    kind: Literal["job_screenshot", "resume"] = Form(...),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    try:
        attachment = create_attachment(
            conversation_id,
            kind,
            (file.filename or "attachment").strip(),
            await file.read(),
        )
    except ValueError as exc:
        status_code = 404 if str(exc) == "对话不存在" else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        await file.close()
    return attachment


@router.post("/attachments/{attachment_id}/parse")
def attachments_parse(
    attachment_id: str,
    mode: str = Form(default="fast"),
) -> dict[str, Any]:
    try:
        return parse_attachment(attachment_id, mode=mode)
    except ValueError as exc:
        status_code = 404 if str(exc) == "附件不存在" else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.delete("/attachments/{attachment_id}")
def attachments_delete(attachment_id: str) -> dict[str, bool]:
    if not delete_attachment(attachment_id):
        raise HTTPException(status_code=404, detail="附件不存在")
    return {"deleted": True}


@router.get("/attachments/config")
def attachments_config() -> dict[str, Any]:
    settings = get_settings()
    minio_configured = bool(
        settings.minio_endpoint
        and settings.minio_access_key
        and settings.minio_secret_key
        and settings.minio_bucket
    )
    vision_ready = (
        settings.attachment_vision_enabled
        and settings.attachment_storage == "minio"
        and bool(settings.minio_public_endpoint)
        and minio_configured
    )
    checks = [
        {
            "key": "local_storage",
            "label": "本地附件目录",
            "status": "ok",
            "message": "可用于默认本地解析与临时附件保存",
        },
        {
            "key": "minio_private_storage",
            "label": "MinIO 私有存储",
            "status": (
                "ok"
                if settings.attachment_storage == "local" or minio_configured
                else "warning"
            ),
            "message": (
                "当前使用本地附件目录"
                if settings.attachment_storage == "local"
                else "MinIO 必要配置已填写"
                if minio_configured
                else "缺少 MINIO_ENDPOINT、MINIO_ACCESS_KEY、MINIO_SECRET_KEY 或 MINIO_BUCKET"
            ),
        },
        {
            "key": "vision_public_url",
            "label": "图片直传公网地址",
            "status": (
                "ok"
                if vision_ready
                else "warning"
                if settings.attachment_vision_enabled
                else "disabled"
            ),
            "message": (
                "岗位截图可按次生成短期签名 URL"
                if vision_ready
                else "图片直传未启用"
                if not settings.attachment_vision_enabled
                else "需要 MinIO 私有存储和 MINIO_PUBLIC_ENDPOINT"
            ),
        },
    ]
    return {
        "storage": settings.attachment_storage,
        "vision_enabled": settings.attachment_vision_enabled,
        "vision_ready": vision_ready,
        "vision_url_ttl_seconds": settings.attachment_vision_url_ttl_seconds,
        "requires_public_endpoint": (
            settings.attachment_vision_enabled and not settings.minio_public_endpoint
        ),
        "checks": checks,
    }


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


@router.post("/library/document/parse")
async def parse_candidate_resume(
    file: UploadFile = File(...),
    mode: str = Form(default="fast"),
) -> dict[str, Any]:
    filename = (file.filename or "document").strip()
    try:
        content = await file.read()
        result = profile_service.parse_candidate_resume(filename, content, mode)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail="无法解析该资料，请确认文件或截图清晰、未损坏且包含可识别文字",
        ) from exc
    finally:
        await file.close()


@router.delete("/library/document")
def career_profile_resume_delete() -> dict[str, Any]:
    try:
        return {"profile": clear_candidate_resume()}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/library/privacy/scan")
def scan_candidate_privacy(payload: PrivacyScanIn) -> dict[str, Any]:
    return profile_service.scan_candidate_privacy(payload.text)


@router.get("/library")
def career_profile_get() -> dict[str, Any]:
    return get_library()


@router.put("/library")
def career_profile_put(payload: CareerProfileInitIn) -> dict[str, Any]:
    create_or_update_profile(**payload.model_dump())
    return get_library()


@router.get("/library/sources")
def career_profile_sources_get() -> list[dict[str, Any]]:
    return list_sources()


@router.post("/library/sources")
def career_profile_sources_post(payload: LibrarySourceIn) -> dict[str, Any]:
    try:
        source = create_text_source(
            title=payload.title,
            content=payload.content,
            source_uri=payload.source_uri,
            privacy_mode=payload.privacy_mode,
        )
        return {"source": source, "proposals": []}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/library/sources/import")
async def library_sources_import(
    files: list[UploadFile] = File(...),
    mode: str = Form(default="fast"),
    privacy_mode: Literal["redacted", "original"] = Form(default="redacted"),
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for file in files:
        filename = (file.filename or "document").strip()
        try:
            source = import_file_source(
                filename=filename,
                content_bytes=await file.read(),
                mode=mode,
                privacy_mode=privacy_mode,
            )
            results.append({"filename": filename, "ok": True, "source": source})
        except Exception as exc:
            results.append({
                "filename": filename,
                "ok": False,
                "error": str(exc) if isinstance(exc, ValueError) else "无法解析或保存该资料",
            })
        finally:
            await file.close()
    return {"results": results}


@router.get("/library/sources/{source_id}")
def library_source_get(source_id: int) -> dict[str, Any]:
    try:
        return get_source(source_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/library/sources/{source_id}/file")
def library_source_file_get(source_id: int) -> FileResponse:
    try:
        path, filename, mime_type = get_source_file(source_id)
        return FileResponse(path, filename=filename, media_type=mime_type)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/library/sources/{source_id}")
def library_source_patch(source_id: int, payload: LibrarySourceUpdateIn) -> dict[str, Any]:
    try:
        return update_source(
            source_id,
            **payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        status_code = 404 if "不存在" in str(exc) else 422
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.delete("/library/sources/{source_id}")
def library_source_delete(source_id: int) -> dict[str, bool]:
    try:
        return {"deleted": delete_source(source_id)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/library/facts")
def career_profile_facts_get(
    status: Literal["pending", "confirmed", "disputed", "retracted"] | None = None,
    category: str | None = None,
) -> list[dict[str, Any]]:
    try:
        return list_facts(status=status, category=category)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/library/facts")
def career_profile_facts_post(payload: CandidateFactIn) -> dict[str, Any]:
    try:
        return propose_fact(**payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/library/facts/{fact_id}/review")
def career_profile_fact_review(
    fact_id: int,
    payload: CandidateFactReviewIn,
) -> dict[str, Any]:
    status_value = {
        "confirm": "confirmed",
        "edit": "confirmed",
        "reject": "disputed",
        "retract": "retracted",
    }[payload.action]
    try:
        result = review_fact(fact_id, status=status_value, statement=payload.statement)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc


@router.post("/library/facts/{fact_id}/merge")
def career_profile_fact_merge(
    fact_id: int,
    payload: CandidateFactMergeIn,
) -> dict[str, Any]:
    try:
        return merge_facts(fact_id, payload.target_fact_id)
    except ValueError as exc:
        raise HTTPException(status_code=404 if "不存在" in str(exc) else 422, detail=str(exc)) from exc

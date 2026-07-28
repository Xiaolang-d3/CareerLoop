from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..agent import get_agent_capabilities
from ..agent.bootstrap import reload_agent_components
from ..agent_settings import get_agent_settings, save_agent_settings
from ..attachments import (
    create_attachment,
    delete_attachment,
    delete_conversation_attachments,
    list_attachments,
    parse_attachment,
)
from ..config import get_settings
from ..conversations import (
    create_conversation,
    delete_conversation,
    list_conversations,
    reset_conversation_context,
    update_conversation,
)
from ..db import connect
from ..services import profile as profile_service
from ..workflow.engine import refresh_workflow_status
from .dependencies import require_conversation
from .schemas import (
    AgentSettingsIn,
    CandidateProfileIn,
    ConversationIn,
    ConversationUpdate,
    PrivacyScanIn,
)


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


@router.get("/workflow/status")
def workflow_status(conversation_id: int | None = None) -> dict[str, Any]:
    if conversation_id is not None:
        require_conversation(conversation_id)
    return refresh_workflow_status(conversation_id)


@router.get("/agent/capabilities")
def agent_capabilities() -> dict[str, Any]:
    return get_agent_capabilities()


@router.get("/agent/settings")
def agent_settings_get() -> dict[str, Any]:
    return get_agent_settings()


@router.put("/agent/settings")
def agent_settings_put(payload: AgentSettingsIn) -> dict[str, Any]:
    saved = save_agent_settings(payload.model_dump())
    reload_agent_components()
    return saved


@router.get("/candidate-profile")
def get_candidate_profile() -> dict[str, Any]:
    return profile_service.get_candidate_profile()


@router.put("/candidate-profile")
def save_candidate_profile(payload: CandidateProfileIn) -> dict[str, Any]:
    return profile_service.save_candidate_profile(payload)


@router.post("/candidate-profile/resume/parse")
async def parse_candidate_resume(
    file: UploadFile = File(...),
    mode: str = Form(default="fast"),
) -> dict[str, Any]:
    filename = (file.filename or "resume").strip()
    try:
        content = await file.read()
        return profile_service.parse_candidate_resume(filename, content, mode)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail="无法解析该简历，请确认文件或截图清晰、未损坏且包含可识别文字",
        ) from exc
    finally:
        await file.close()


@router.post("/candidate-profile/privacy/scan")
def scan_candidate_privacy(payload: PrivacyScanIn) -> dict[str, Any]:
    return profile_service.scan_candidate_privacy(payload.text)

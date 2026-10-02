from __future__ import annotations

from typing import Any, Literal
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from ..attachments.service import (
    create_attachment,
    delete_attachment,
    list_attachments,
    parse_attachment,
)
from ..config import get_settings
from .dependencies import require_conversation


router = APIRouter()


@router.get("/conversations/{conversation_id}/attachments")
def conversation_attachments(conversation_id: int) -> list[dict[str, Any]]:
    require_conversation(conversation_id)
    return list_attachments(conversation_id)


@router.post("/attachments")
async def attachments_upload(
    conversation_id: int = Form(...),
    kind: Literal["image", "document"] = Form(...),
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

from __future__ import annotations

from typing import Any
from ag_ui.core import RunAgentInput
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse, FileResponse, Response
from pydantic import ValidationError
from .dependencies import require_conversation
from ..chat.contracts import ChatMessageIn
from ..chat.conversations import end_active_task
from ..db import connect, row_to_dict, rows_to_dicts
from ..agent.snapshots import clear_run_snapshot
from ..chat.service import (
    default_conversation_id as _default_conversation_id,
    refresh_conversation_summary as _refresh_conversation_summary,
)
from fastapi import APIRouter
from ..chat import execution
from ..chat.execution import stream_chat_response, is_chat_running
from ..chat.artifacts import ArtifactConflict, SaveArtifactIn, message_artifacts, save_artifact
from ..chat.image_assets import with_generation_prompts


router = APIRouter()


@router.get("/chat-assets/{asset_id}/file")
def generated_image_file(asset_id: str):
    from ..chat.image_assets import asset_file
    try:
        path, filename, mime = asset_file(asset_id)
        return FileResponse(path, filename=filename, media_type=mime, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/chat-assets/{asset_id}/thumbnail")
def generated_image_thumbnail(asset_id: str):
    from ..chat.image_assets import asset_thumbnail
    try:
        return Response(asset_thumbnail(asset_id), media_type="image/webp", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=404, detail="生成图片预览不可用") from exc


@router.get("/chat/messages/{message_id}/artifacts")
def chat_message_artifacts(message_id: int) -> dict[str, Any]:
    try:
        return message_artifacts(message_id)
    except ValueError as exc:
        raise HTTPException(status_code=409 if isinstance(exc, ArtifactConflict) else 404, detail=str(exc)) from exc


@router.post("/chat/messages/{message_id}/save-to-library")
def chat_message_save(message_id: int, payload: SaveArtifactIn) -> dict[str, Any]:
    try:
        return save_artifact(message_id, payload)
    except ValueError as exc:
        code = 409 if isinstance(exc, ArtifactConflict) else 404 if str(exc) == "消息不存在" else 422
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail="本地文件保存失败，请检查磁盘空间后重试") from exc


@router.get("/chat/messages")
def list_chat_messages(conversation_id: int | None = None) -> list[dict[str, Any]]:
    resolved_id = conversation_id or _default_conversation_id()
    require_conversation(resolved_id)
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC",
            (resolved_id,),
        ).fetchall()
    return with_generation_prompts(rows_to_dicts(rows), resolved_id)


@router.delete("/chat/messages/{message_id}/tail")
def rewind_chat_messages(message_id: int, conversation_id: int | None = None) -> dict[str, Any]:
    """Remove a user turn and everything after it before editing or regenerating."""
    resolved_id = conversation_id or _default_conversation_id()
    require_conversation(resolved_id)
    if is_chat_running(resolved_id):
        raise HTTPException(status_code=409, detail="请先停止当前生成任务")

    with connect() as conn:
        message = conn.execute(
            "SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?",
            (message_id, resolved_id),
        ).fetchone()
        if message is None:
            raise HTTPException(status_code=404, detail="消息不存在")
        if message["role"] != "user":
            raise HTTPException(status_code=400, detail="只能从用户消息开始回退")
        from ..chat.image_assets import delete_images
        delete_images(resolved_id, message_cutoff=message_id)
        deleted = conn.execute(
            "DELETE FROM chat_messages WHERE conversation_id = ? AND id >= ?",
            (resolved_id, message_id),
        ).rowcount
        conversation = conn.execute(
            "SELECT title FROM conversations WHERE id = ?", (resolved_id,)
        ).fetchone()
        generated_title = " ".join(message["content"].strip().split())[:28] or "新对话"
        next_title = "新对话" if conversation and conversation["title"] == generated_title else conversation["title"]
        conn.execute(
            """
            UPDATE conversations
            SET title = ?, context_cutoff_message_id = MIN(context_cutoff_message_id, ?),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (next_title, max(message_id - 1, 0), resolved_id),
        )

    end_active_task(resolved_id)
    clear_run_snapshot(resolved_id)
    _refresh_conversation_summary(resolved_id)
    return {
        "rewound": True,
        "deleted": deleted,
        "source_message": row_to_dict(message),
    }


def _ag_ui_message_content(payload: RunAgentInput) -> str:
    for message in reversed(payload.messages):
        if message.role != "user":
            continue
        if isinstance(message.content, str):
            return message.content.strip()
        text_parts = []
        for part in message.content:
            if getattr(part, "type", None) == "text":
                text_parts.append(getattr(part, "text", ""))
        return "\n".join(text_parts).strip()
    return ""


def _ag_ui_attachment_ids(payload: RunAgentInput) -> list[str]:
    forwarded = payload.forwarded_props or {}
    raw_ids = forwarded.get("attachmentIds", []) if isinstance(forwarded, dict) else []
    if not isinstance(raw_ids, list) or any(not isinstance(item, str) for item in raw_ids):
        raise HTTPException(status_code=422, detail="attachmentIds 必须是附件 ID 数组")
    return raw_ids[:8]


def _ag_ui_vision_attachment_ids(payload: RunAgentInput) -> list[str]:
    forwarded = payload.forwarded_props or {}
    raw_ids = forwarded.get("visionAttachmentIds", []) if isinstance(forwarded, dict) else []
    if not isinstance(raw_ids, list) or any(not isinstance(item, str) for item in raw_ids):
        raise HTTPException(status_code=422, detail="visionAttachmentIds 必须是附件 ID 数组")
    return raw_ids[:4]


def _ag_ui_web_search_fields(payload: RunAgentInput) -> dict[str, Any]:
    forwarded = payload.forwarded_props or {}
    if not isinstance(forwarded, dict):
        return {}
    mapping = {
        "webSearch": "web_search",
        "webSearchMode": "web_search_mode",
        "webSearchTopic": "web_search_topic",
        "webSearchSourcePreference": "web_search_source_preference",
        "webSearchProvider": "web_search_provider",
    }
    # Omitting a key must remain distinguishable from choosing false/auto/none.
    return {field: forwarded[key] for key, field in mapping.items() if key in forwarded}


@router.post("/ag-ui")
async def run_ag_ui(payload: dict[str, Any], request: Request) -> StreamingResponse:
    """AG-UI standard HTTP/SSE endpoint."""
    try:
        ag_ui_input = RunAgentInput.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False)) from exc
    try:
        conversation_id = int(ag_ui_input.thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="threadId 必须是本地对话 ID") from exc
    content = _ag_ui_message_content(ag_ui_input)
    if not content:
        raise HTTPException(status_code=422, detail="messages 中缺少用户文本消息")
    forwarded = ag_ui_input.forwarded_props or {}
    model_selection = {}
    if isinstance(forwarded, dict) and "modelProfileId" in forwarded:
        selected = forwarded["modelProfileId"]
        if selected is not None and (not isinstance(selected, str) or not selected.strip() or len(selected) > 120):
            raise HTTPException(status_code=422, detail="modelProfileId 必须是模型档案 ID 或 null")
        model_selection["model_profile_id"] = selected
    try:
        chat_input = ChatMessageIn(
            content=content,
            conversation_id=conversation_id,
            attachment_ids=_ag_ui_attachment_ids(ag_ui_input),
            vision_attachment_ids=_ag_ui_vision_attachment_ids(ag_ui_input),
            **_ag_ui_web_search_fields(ag_ui_input),
            **model_selection,
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False)) from exc
    return await stream_chat_response(
        chat_input,
        ag_ui_input=ag_ui_input,
        accept=request.headers.get("accept"),
    )


@router.post("/agent/tasks/current/cancel")
async def cancel_current_agent_task(conversation_id: int | None = None) -> dict[str, Any]:
    return await execution.cancel_current_agent_task(conversation_id)


@router.get("/agent/runs/current")
def current_durable_agent_run(conversation_id: int | None = None) -> dict[str, Any]:
    return execution.current_durable_agent_run(conversation_id)


@router.post("/agent/runs/{run_id}/cancel")
def cancel_durable_agent_run(run_id: str) -> dict[str, Any]:
    return execution.cancel_durable_agent_run(run_id)

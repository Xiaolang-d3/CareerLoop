from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException
from ..attachments.service import delete_conversation_attachments
from ..agent.snapshots import clear_run_snapshot
from ..chat.conversations import (
    create_conversation,
    delete_conversation,
    list_conversations,
    reset_conversation_context,
    update_conversation,
)
from .dependencies import require_conversation
from .schemas import ConversationIn, ConversationUpdate


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

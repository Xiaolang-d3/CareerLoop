from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from ..chat.conversations import get_conversation


def require_conversation(conversation_id: int) -> dict[str, Any]:
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="对话不存在")
    return conversation

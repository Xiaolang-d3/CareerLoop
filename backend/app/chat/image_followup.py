"""Resolve an explicit repeat request against the immediately preceding image."""
from __future__ import annotations

import re

from ..db import connect
from ..agent.settings import get_agent_settings
from .image_assets import image_generation_intent


_REPEAT = re.compile(
    r"^(?:(?:请|帮我|麻烦你|麻烦)\s*)*"
    r"(?:(?:再|重新)(?:生成|画|绘制)(?:一张|一幅|一个版本)?(?:图片|图像|图)?"
    r"|再来(?:一张|一幅)(?:图片|图像|图)?)\s*[。！!]?$")
_PREFIX = "生成一张图片，沿用以下画面要求，重新创作一个版本：\n\n"


def resolve_image_followup(content: str, conversation_id: int, db_path=None) -> str:
    # A current, explicit repeat command authorizes generation. History only
    # supplies its subject, never the authorization to call a billed tool.
    if not _REPEAT.fullmatch(content.strip()):
        return content
    settings = get_agent_settings(db_path)
    if not settings["conversation_memory_enabled"]:
        return content
    with connect(db_path) as conn:
        messages = conn.execute(
            "SELECT m.id, m.role, m.content FROM chat_messages m JOIN conversations c ON c.id=m.conversation_id "
            "WHERE m.conversation_id=? AND m.id > c.context_cutoff_message_id ORDER BY m.id DESC LIMIT ?",
            (conversation_id, min(20, settings["context_message_limit"])),
        ).fetchall()
        for index in range(0, len(messages) - 1, 2):
            assistant, user = messages[index:index + 2]
            if assistant["role"] != "assistant" or user["role"] != "user":
                return content
            image = conn.execute(
                "SELECT 1 FROM chat_image_assets WHERE conversation_id=? AND message_id=? LIMIT 1",
                (conversation_id, assistant["id"]),
            ).fetchone()
            if image is None:
                # A new explicit repeat can recover from an earlier rejected
                # repeat, but must never skip unrelated conversation turns.
                if _REPEAT.fullmatch(user["content"].strip()):
                    continue
                return content
            run = conn.execute(
                "SELECT user_content FROM agent_execution_runs WHERE conversation_id=? "
                "AND assistant_message_id=? AND user_message_id=? AND status='completed' LIMIT 1",
                (conversation_id, assistant["id"], user["id"]),
            ).fetchone()
            # Durable input retains the subject across consecutive repeats.
            # Legacy images fall back to their paired user instruction.
            prompt = run["user_content"] if run else user["content"]
            if not image_generation_intent(prompt, image_model_selected=True):
                return content
            return prompt if prompt.startswith(_PREFIX) else f"{_PREFIX}{prompt}\n\n仅生成一张新图片。"
    return content

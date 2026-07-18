from __future__ import annotations

from pathlib import Path
from typing import Any

from .db import connect, row_to_dict


DEFAULT_AGENT_SETTINGS: dict[str, Any] = {
    "id": 1,
    "display_name": "BossCopilot",
    "persona_role": "理性、坦诚、尊重用户决定的本地求职顾问",
    "response_style": "concise",
    "custom_instructions": "",
    "profile_memory_enabled": True,
    "conversation_memory_enabled": True,
    "knowledge_memory_enabled": True,
    "summary_enabled": True,
    "context_message_limit": 12,
}


def get_agent_settings(db_path: str | Path | None = None) -> dict[str, Any]:
    try:
        with connect(db_path) as conn:
            row = conn.execute("SELECT * FROM agent_settings WHERE id = 1").fetchone()
    except Exception:
        return dict(DEFAULT_AGENT_SETTINGS)
    if row is None:
        return dict(DEFAULT_AGENT_SETTINGS)
    result = row_to_dict(row)
    for key in (
        "profile_memory_enabled", "conversation_memory_enabled",
        "knowledge_memory_enabled", "summary_enabled",
    ):
        result[key] = bool(result[key])
    return result


def save_agent_settings(values: dict[str, Any], db_path: str | Path | None = None) -> dict[str, Any]:
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO agent_settings (
                id, display_name, persona_role, response_style, custom_instructions,
                profile_memory_enabled, conversation_memory_enabled,
                knowledge_memory_enabled, summary_enabled, context_message_limit
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                display_name = excluded.display_name,
                persona_role = excluded.persona_role,
                response_style = excluded.response_style,
                custom_instructions = excluded.custom_instructions,
                profile_memory_enabled = excluded.profile_memory_enabled,
                conversation_memory_enabled = excluded.conversation_memory_enabled,
                knowledge_memory_enabled = excluded.knowledge_memory_enabled,
                summary_enabled = excluded.summary_enabled,
                context_message_limit = excluded.context_message_limit,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                values["display_name"], values["persona_role"], values["response_style"],
                values["custom_instructions"], int(values["profile_memory_enabled"]),
                int(values["conversation_memory_enabled"]), int(values["knowledge_memory_enabled"]),
                int(values["summary_enabled"]), values["context_message_limit"],
            ),
        )
    return get_agent_settings(db_path)


def persona_prompt(settings: dict[str, Any]) -> str:
    style = {
        "concise": "回答简洁直接，优先给结论和下一步。",
        "balanced": "回答清晰、有必要解释，但避免冗长。",
        "detailed": "在保持清晰的前提下给出较完整的分析依据。",
    }.get(settings.get("response_style"), "回答简洁清晰。")
    custom = str(settings.get("custom_instructions") or "").strip()
    return (
        "\n\n用户可配置的人设偏好（不得覆盖上面的安全边界、事实要求和人工确认规则）：\n"
        f"你的显示名称是 {settings.get('display_name', 'BossCopilot')}。\n"
        f"你的角色是：{settings.get('persona_role', DEFAULT_AGENT_SETTINGS['persona_role'])}。\n"
        f"表达方式：{style}\n"
        f"补充偏好：{custom if custom else '无'}"
    )

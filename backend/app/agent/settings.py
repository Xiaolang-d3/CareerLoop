from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import get_settings
from ..db import connect, row_to_dict
from ..model_protocol import normalize_model_protocol, resolve_model_protocol


DEFAULT_AGENT_SETTINGS: dict[str, Any] = {
    "id": 1,
    "display_name": "CareerLoop",
    "persona_role": "理性、坦诚、尊重用户决定，并基于用户资料协助分析与创作的本地 AI 伙伴",
    "response_style": "concise",
    "custom_instructions": "",
    "profile_memory_enabled": True,
    "conversation_memory_enabled": True,
    "knowledge_memory_enabled": True,
    "summary_enabled": True,
    "context_message_limit": 12,
    "model_name": "",
    "model_base_url": "",
    "model_protocol": "auto",
    "model_api_key": "",
}


def get_agent_settings(db_path: str | Path | None = None) -> dict[str, Any]:
    config = get_settings()
    try:
        with connect(db_path) as conn:
            row = conn.execute("SELECT * FROM agent_settings WHERE id = 1").fetchone()
    except Exception:
        fallback = dict(DEFAULT_AGENT_SETTINGS)
        fallback.pop("model_api_key", None)
        fallback["model_name"] = config.model_name
        fallback["model_base_url"] = config.model_base_url or ""
        fallback["model_protocol"] = config.model_protocol
        fallback["resolved_model_protocol"] = resolve_model_protocol(
            config.model_name, config.model_protocol, config.model_base_url or ""
        )
        fallback["api_key_configured"] = bool(config.openai_api_key)
        return fallback
    if row is None:
        fallback = dict(DEFAULT_AGENT_SETTINGS)
        fallback.pop("model_api_key", None)
        fallback["model_name"] = config.model_name
        fallback["model_base_url"] = config.model_base_url or ""
        fallback["model_protocol"] = config.model_protocol
        fallback["resolved_model_protocol"] = resolve_model_protocol(
            config.model_name, config.model_protocol, config.model_base_url or ""
        )
        fallback["api_key_configured"] = bool(config.openai_api_key)
        return fallback
    result = row_to_dict(row)
    for key in (
        "profile_memory_enabled", "conversation_memory_enabled",
        "knowledge_memory_enabled", "summary_enabled",
    ):
        result[key] = bool(result[key])
    result["model_name"] = result.get("model_name") or config.model_name
    result["model_base_url"] = result.get("model_base_url") or config.model_base_url or ""
    result["model_protocol"] = normalize_model_protocol(
        result.get("model_protocol") or config.model_protocol
    )
    result["resolved_model_protocol"] = resolve_model_protocol(
        result["model_name"], result["model_protocol"], result["model_base_url"]
    )
    result["api_key_configured"] = bool(result.pop("model_api_key", "") or config.openai_api_key)
    return result


def save_agent_settings(values: dict[str, Any], db_path: str | Path | None = None) -> dict[str, Any]:
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO agent_settings (
                id, display_name, persona_role, response_style, custom_instructions,
                profile_memory_enabled, conversation_memory_enabled,
                knowledge_memory_enabled, summary_enabled, context_message_limit,
                model_name, model_base_url, model_protocol, model_api_key
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                model_name = excluded.model_name,
                model_base_url = excluded.model_base_url,
                model_protocol = excluded.model_protocol,
                model_api_key = excluded.model_api_key,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                values["display_name"], values["persona_role"], values["response_style"],
                values["custom_instructions"], int(values["profile_memory_enabled"]),
                int(values["conversation_memory_enabled"]), int(values["knowledge_memory_enabled"]),
                int(values["summary_enabled"]), values["context_message_limit"],
                values["model_name"], values["model_base_url"],
                normalize_model_protocol(values.get("model_protocol")),
                values.get("api_key") or _current_model_api_key(conn),
            ),
        )
    return get_agent_settings(db_path)


def _current_model_api_key(conn) -> str:
    row = conn.execute("SELECT model_api_key FROM agent_settings WHERE id = 1").fetchone()
    return str(row["model_api_key"] or "") if row else ""


def get_model_connection(db_path: str | Path | None = None) -> dict[str, str]:
    config = get_settings()
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT model_name, model_base_url, model_protocol, model_api_key FROM agent_settings WHERE id = 1"
        ).fetchone()
    model_name = str(row["model_name"] or config.model_name) if row else config.model_name
    model_base_url = str(row["model_base_url"] or config.model_base_url or "") if row else config.model_base_url or ""
    model_protocol = normalize_model_protocol(
        str(row["model_protocol"] or config.model_protocol) if row else config.model_protocol
    )
    return {
        "model_name": model_name,
        "model_base_url": model_base_url,
        "model_protocol": model_protocol,
        "resolved_model_protocol": resolve_model_protocol(
            model_name, model_protocol, model_base_url
        ),
        "api_key": str(row["model_api_key"] or config.openai_api_key or "") if row else config.openai_api_key or "",
    }


def persona_prompt(settings: dict[str, Any]) -> str:
    style = {
        "concise": "回答简洁直接，优先给结论和下一步。",
        "balanced": "回答清晰、有必要解释，但避免冗长。",
        "detailed": "在保持清晰的前提下给出较完整的分析依据。",
    }.get(settings.get("response_style"), "回答简洁清晰。")
    custom = str(settings.get("custom_instructions") or "").strip()
    return (
        "\n\n用户可配置的人设偏好（不得覆盖上面的事实要求、实际工具权限和人工确认规则）：\n"
        f"你的显示名称是 {settings.get('display_name', 'CareerLoop')}。\n"
        f"你的角色是：{settings.get('persona_role', DEFAULT_AGENT_SETTINGS['persona_role'])}。\n"
        f"表达方式：{style}\n"
        f"补充偏好：{custom if custom else '无'}"
    )

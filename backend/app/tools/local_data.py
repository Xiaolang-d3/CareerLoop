from __future__ import annotations

from pathlib import Path
from typing import Any

from ..db import connect, row_to_dict
from ..agent_settings import get_agent_settings
from ..domain import ToolError, ToolResult
from ..privacy import scan_and_redact


def resolve_profile(
    profile_id: int | None,
    db_path: str | Path | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Return the selected profile and its optional preferences."""
    if not get_agent_settings(db_path)["profile_memory_enabled"]:
        return None, None
    with connect(db_path) as conn:
        if profile_id is None:
            profile_row = conn.execute(
                "SELECT * FROM profiles ORDER BY updated_at DESC, id DESC LIMIT 1"
            ).fetchone()
        else:
            profile_row = conn.execute(
                "SELECT * FROM profiles WHERE id = ?", (profile_id,)
            ).fetchone()
        if profile_row is None:
            return None, None
        preference_row = conn.execute(
            "SELECT * FROM preferences WHERE profile_id = ?",
            (profile_row["id"],),
        ).fetchone()
    return row_to_dict(profile_row), row_to_dict(preference_row)


def get_job(local_id: int, db_path: str | Path | None = None) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (local_id,)).fetchone()
    return row_to_dict(row)


def profile_for_agent(profile: dict[str, Any]) -> dict[str, Any]:
    """Return an isolated profile copy that respects the configured privacy mode."""
    safe_profile = dict(profile)
    original_text = str(safe_profile.get("resume_text") or "")
    if safe_profile.get("privacy_mode", "redacted") == "redacted":
        safe_profile["resume_text"] = (
            safe_profile.get("resume_redacted_text")
            or scan_and_redact(original_text)[1]
        )
    safe_profile.pop("resume_redacted_text", None)
    safe_profile["resume_privacy"] = {
        "mode": safe_profile.get("privacy_mode", "redacted"),
        "original_character_count": len(original_text),
    }
    return safe_profile


def invalid_arguments(message: str, error: Exception) -> ToolResult:
    return ToolResult(
        ok=False,
        status="failed",
        message=message,
        error=ToolError(code="invalid_arguments", message=str(error)),
    )

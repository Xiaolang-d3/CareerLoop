from __future__ import annotations

import functools
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ..profile.candidate_core import (
    ProfileNotInitializedError,
    blocked_skill_names,
    resolved_skill_names,
)
from ..db import connect, row_to_dict
from ..agent.settings import get_agent_settings
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
    profile = row_to_dict(profile_row)
    if profile is not None:
        try:
            profile["skills"] = resolved_skill_names(db_path=db_path)
            profile["blocked_skills"] = blocked_skill_names(db_path=db_path)
        except ProfileNotInitializedError:
            profile["skills"] = []
            profile["blocked_skills"] = []
    return profile, row_to_dict(preference_row)


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


PROFILE_REQUIRED_GUIDANCE = (
    "还没有候选人画像。说“开始画像访谈”，我会创建画像并一次一个问题地帮你补充信息；"
    "你也可以在设置页直接填写。"
)


def profile_required(message: str) -> ToolResult:
    """A missing precondition the user can clear in one reply, not a bad argument."""
    return ToolResult(
        ok=False,
        status="failed",
        message=message,
        error=ToolError(
            code="profile_required",
            message=PROFILE_REQUIRED_GUIDANCE,
            retryable=True,
        ),
    )


def tool_error_boundary(message: str):
    """Wrap a tool's ``execute`` so precondition and argument failures stay distinct.

    Every candidate tool used to funnel both into ``invalid_arguments``, which
    mislabeled "no profile yet" as "bad arguments". ``ProfileNotInitializedError``
    is matched first because it subclasses ``ValueError``.
    """

    def decorator(execute):
        @functools.wraps(execute)
        async def wrapper(self, arguments: dict[str, Any], context) -> ToolResult:
            try:
                return await execute(self, arguments, context)
            except ProfileNotInitializedError:
                return profile_required(message)
            except (ValidationError, ValueError) as exc:
                return invalid_arguments(message, exc)

        return wrapper

    return decorator

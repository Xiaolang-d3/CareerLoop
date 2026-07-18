from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..db import connect, row_to_dict
from ..domain import ToolDefinition, ToolError, ToolResult
from .base import ToolContext
from .local_data import invalid_arguments, resolve_profile


class SaveGreetingDraftArguments(BaseModel):
    local_id: int = Field(ge=1)
    profile_id: int | None = Field(default=None, ge=1)
    text: str = Field(min_length=1, max_length=500)
    style: Literal["concise", "technical", "project", "enthusiastic"] = "concise"


class SaveGreetingDraftTool:
    definition = ToolDefinition(
        name="save_greeting_draft",
        description=(
            "保存一条针对指定岗位的本地沟通话术草稿；只保存草稿，"
            "不会打开 BOSS、不会发送消息"
        ),
        input_schema=SaveGreetingDraftArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = SaveGreetingDraftArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("沟通草稿参数不合法", exc)
        profile, _ = resolve_profile(payload.profile_id, self._db_path)
        if profile is None:
            return self._missing("candidate_profile_missing", "尚未配置候选人画像")
        with connect(self._db_path) as conn:
            job = conn.execute("SELECT id, title FROM jobs WHERE id = ?", (payload.local_id,)).fetchone()
            if job is None:
                return self._missing("job_not_found", "本地岗位不存在")
            cursor = conn.execute(
                """
                INSERT INTO messages (job_id, profile_id, style, generated_text, status)
                VALUES (?, ?, ?, ?, 'draft')
                """,
                (payload.local_id, profile["id"], payload.style, payload.text),
            )
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (cursor.lastrowid,)).fetchone()
        draft = row_to_dict(row)
        return ToolResult(
            ok=True,
            status="done",
            data={"draft": draft, "job_title": job["title"]},
            message=f"已保存沟通草稿：{job['title']}（尚未发送）",
        )

    @staticmethod
    def _missing(code: str, message: str) -> ToolResult:
        return ToolResult(
            ok=False,
            status="failed",
            message=message,
            error=ToolError(code=code, message=message),
        )

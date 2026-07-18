from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..db import connect, row_to_dict
from ..domain import ToolDefinition, ToolError, ToolResult
from .base import ToolContext
from .local_data import invalid_arguments, resolve_profile


class QueueApplicationArguments(BaseModel):
    local_id: int = Field(ge=1)
    profile_id: int | None = Field(default=None, ge=1)
    notes: str = Field(default="", max_length=1000)


class QueueApplicationTool:
    definition = ToolDefinition(
        name="queue_application",
        description=(
            "把岗位加入本地待投递队列，供用户后续确认；"
            "不会在 BOSS 发起沟通、发送简历或执行投递"
        ),
        input_schema=QueueApplicationArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = QueueApplicationArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("待投递队列参数不合法", exc)
        profile, _ = resolve_profile(payload.profile_id, self._db_path)
        if profile is None:
            return self._missing("candidate_profile_missing", "尚未配置候选人画像")
        with connect(self._db_path) as conn:
            job = conn.execute("SELECT id, title FROM jobs WHERE id = ?", (payload.local_id,)).fetchone()
            if job is None:
                return self._missing("job_not_found", "本地岗位不存在")
            existing = conn.execute(
                """
                SELECT * FROM applications
                WHERE job_id = ? AND profile_id = ? AND status = 'queued'
                ORDER BY id DESC LIMIT 1
                """,
                (payload.local_id, profile["id"]),
            ).fetchone()
            if existing is None:
                cursor = conn.execute(
                    """
                    INSERT INTO applications (job_id, profile_id, status, notes)
                    VALUES (?, ?, 'queued', ?)
                    """,
                    (payload.local_id, profile["id"], payload.notes),
                )
                existing = conn.execute(
                    "SELECT * FROM applications WHERE id = ?", (cursor.lastrowid,)
                ).fetchone()
        application = row_to_dict(existing)
        return ToolResult(
            ok=True,
            status="done",
            data={"application": application, "job_title": job["title"]},
            message=f"已加入本地待投递队列：{job['title']}（尚未执行外部操作）",
        )

    @staticmethod
    def _missing(code: str, message: str) -> ToolResult:
        return ToolResult(
            ok=False,
            status="failed",
            message=message,
            error=ToolError(code=code, message=message),
        )

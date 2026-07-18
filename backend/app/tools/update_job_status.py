from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..db import connect, row_to_dict
from ..domain import ToolDefinition, ToolError, ToolResult
from .base import ToolContext
from .local_data import invalid_arguments


class UpdateJobStatusArguments(BaseModel):
    local_id: int = Field(ge=1)
    status: Literal["new", "shortlisted", "skipped"]


class UpdateJobStatusTool:
    definition = ToolDefinition(
        name="update_job_status",
        description="在本地工作台将岗位标记为新发现、候选或跳过；不会操作 BOSS 页面",
        input_schema=UpdateJobStatusArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = UpdateJobStatusArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("岗位状态参数不合法", exc)
        with connect(self._db_path) as conn:
            cursor = conn.execute(
                "UPDATE jobs SET status = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?",
                (payload.status, payload.local_id),
            )
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (payload.local_id,)).fetchone()
        if cursor.rowcount == 0 or row is None:
            message = "本地岗位不存在"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="job_not_found", message=message),
            )
        job = row_to_dict(row)
        return ToolResult(
            ok=True,
            status="done",
            data={"job": job},
            message=f"已将岗位标记为 {payload.status}：{job['title']}",
        )

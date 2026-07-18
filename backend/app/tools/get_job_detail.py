from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError, model_validator

from ..db import connect, row_to_dict
from ..domain import ToolDefinition, ToolError, ToolResult
from .base import ToolContext
from .local_data import invalid_arguments


class GetJobDetailArguments(BaseModel):
    local_id: int | None = Field(default=None, ge=1)
    query: str | None = Field(default=None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def require_locator(self):
        if self.local_id is None and not self.query:
            raise ValueError("local_id 或 query 至少提供一个")
        return self


class GetJobDetailTool:
    definition = ToolDefinition(
        name="get_job_detail",
        description="从本地岗位库读取一个已由用户确认导入的岗位详情；不会访问或操作招聘网站",
        input_schema=GetJobDetailArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = GetJobDetailArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("本地岗位查询参数不合法", exc)

        with connect(self._db_path) as conn:
            if payload.local_id is not None:
                row = conn.execute("SELECT * FROM jobs WHERE id = ?", (payload.local_id,)).fetchone()
            else:
                query = f"%{payload.query}%"
                row = conn.execute(
                    """
                    SELECT * FROM jobs
                    WHERE title LIKE ? OR company LIKE ?
                    ORDER BY last_seen_at DESC, id DESC LIMIT 1
                    """,
                    (query, query),
                ).fetchone()
        if row is None:
            return ToolResult(
                ok=False,
                status="failed",
                data={},
                message="本地岗位库中没有找到对应岗位",
                error=ToolError(code="job_not_found", message="本地岗位库中没有找到对应岗位"),
            )
        job = row_to_dict(row)
        return ToolResult(
            ok=True,
            status="done",
            data={"job": job},
            message=f"已读取本地岗位：{job['title']} · {job['company']}",
        )

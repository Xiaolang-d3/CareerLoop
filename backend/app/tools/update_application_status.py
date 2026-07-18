from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..db import connect, row_to_dict
from ..domain import ToolDefinition, ToolError, ToolResult
from .base import ToolContext
from .local_data import invalid_arguments


class UpdateApplicationStatusArguments(BaseModel):
    application_id: int = Field(ge=1)
    status: Literal["queued", "applied", "contacted", "interview", "rejected", "no_response"]
    notes: str | None = Field(default=None, max_length=1000)


class UpdateApplicationStatusTool:
    definition = ToolDefinition(
        name="update_application_status",
        description=(
            "根据用户明确提供的事实更新本地求职记录状态；"
            "只记录状态，不会在 BOSS 执行任何操作"
        ),
        input_schema=UpdateApplicationStatusArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = UpdateApplicationStatusArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("求职状态参数不合法", exc)
        applied_at = "CURRENT_TIMESTAMP" if payload.status == "applied" else "applied_at"
        contact_at = (
            "CURRENT_TIMESTAMP"
            if payload.status in {"contacted", "interview"}
            else "last_contact_at"
        )
        with connect(self._db_path) as conn:
            cursor = conn.execute(
                f"""
                UPDATE applications
                SET status = ?,
                    notes = COALESCE(?, notes),
                    applied_at = {applied_at},
                    last_contact_at = {contact_at},
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (payload.status, payload.notes, payload.application_id),
            )
            row = conn.execute(
                "SELECT * FROM applications WHERE id = ?", (payload.application_id,)
            ).fetchone()
        if cursor.rowcount == 0 or row is None:
            message = "本地求职记录不存在"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="application_not_found", message=message),
            )
        application = row_to_dict(row)
        return ToolResult(
            ok=True,
            status="done",
            data={"application": application},
            message=f"已更新本地求职状态为 {payload.status}",
        )

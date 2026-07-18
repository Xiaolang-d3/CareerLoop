from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from .base import ToolContext
from .local_data import invalid_arguments


class RequestManualJobImportArguments(BaseModel):
    reason: str = Field(min_length=1, max_length=300)


class RequestManualJobImportTool:
    definition = ToolDefinition(
        name="request_manual_job_import",
        description=(
            "请求用户通过粘贴岗位文字或上传自己保存的岗位截图，将岗位主动导入本地。"
            "不会访问、读取或操作任何招聘网站"
        ),
        input_schema=RequestManualJobImportArguments.model_json_schema(),
    )

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = RequestManualJobImportArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("手动岗位导入请求参数不合法", exc)
        return ToolResult(
            ok=True,
            status="waiting_approval",
            data={"reason": payload.reason},
            message="请粘贴岗位内容或上传自己保存的岗位截图，检查后确认导入。",
            error=ToolError(
                code="manual_job_import_required",
                message="等待用户主动提供并确认岗位内容",
            ),
        )

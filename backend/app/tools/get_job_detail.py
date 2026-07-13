from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..errors import CapabilityNotSupportedError, UnknownRegistrationError
from ..platforms import JobPlatformRegistry, PlatformOperationError
from .base import ToolContext


class GetJobDetailArguments(BaseModel):
    external_id: str = Field(min_length=1)


class GetJobDetailTool:
    definition = ToolDefinition(
        name="get_job_detail",
        description="读取指定招聘平台的岗位详情",
        input_schema=GetJobDetailArguments.model_json_schema(),
    )

    def __init__(self, platforms: JobPlatformRegistry) -> None:
        self._platforms = platforms

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = GetJobDetailArguments.model_validate(arguments)
            platform = self._platforms.get(context.platform_name)
            if not platform.capabilities().read_job_detail:
                raise CapabilityNotSupportedError(
                    f"平台 {context.platform_name} 不支持岗位详情读取"
                )
            job = await platform.get_job_detail(payload.external_id)
            return ToolResult(
                ok=True,
                status="done",
                data={"job": job.model_dump(mode="json")},
                message=f"已读取岗位详情：{job.title}",
            )
        except ValidationError as exc:
            return ToolResult(
                ok=False,
                status="failed",
                message="岗位详情参数不合法",
                error=ToolError(code="invalid_arguments", message=str(exc)),
            )
        except (UnknownRegistrationError, CapabilityNotSupportedError) as exc:
            return ToolResult(
                ok=False,
                status="failed",
                message=str(exc),
                error=ToolError(code="platform_unavailable", message=str(exc)),
            )
        except PlatformOperationError as exc:
            return ToolResult(
                ok=False,
                status="blocked" if exc.blocked else "failed",
                message=str(exc),
                error=ToolError(code=exc.code, message=str(exc)),
            )

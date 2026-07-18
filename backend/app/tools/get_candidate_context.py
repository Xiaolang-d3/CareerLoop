from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..agent_settings import get_agent_settings
from .base import ToolContext
from .local_data import invalid_arguments, profile_for_agent, resolve_profile


class GetCandidateContextArguments(BaseModel):
    profile_id: int | None = Field(default=None, ge=1)


class GetCandidateContextTool:
    definition = ToolDefinition(
        name="get_candidate_context",
        description=(
            "读取本地候选人简历、技能、项目经历和求职偏好；"
            "个性化岗位分析或沟通准备前应先调用"
        ),
        input_schema=GetCandidateContextArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if not get_agent_settings(self._db_path)["profile_memory_enabled"]:
            message = "人物画像记忆已在 Agent 设置中关闭"
            return ToolResult(ok=False, status="failed", message=message, error=ToolError(code="profile_memory_disabled", message=message))
        try:
            payload = GetCandidateContextArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("候选人上下文参数不合法", exc)
        profile, preferences = resolve_profile(payload.profile_id, self._db_path)
        if profile is None:
            message = "尚未配置候选人画像，请先录入简历、技能和求职偏好"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="candidate_profile_missing", message=message),
            )
        profile = profile_for_agent(profile)
        return ToolResult(
            ok=True,
            status="done",
            data={"profile": profile, "preferences": preferences},
            message=f"已读取候选人画像：{profile['name']}",
        )

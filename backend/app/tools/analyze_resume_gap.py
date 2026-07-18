from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..profile_intelligence import analyze_gap
from .base import ToolContext
from .local_data import get_job, invalid_arguments, profile_for_agent, resolve_profile


class AnalyzeResumeGapArguments(BaseModel):
    local_id: int = Field(ge=1)
    profile_id: int | None = Field(default=None, ge=1)


class AnalyzeResumeGapTool:
    definition = ToolDefinition(
        name="analyze_resume_gap",
        description="对比本地简历与完整岗位描述，给出技能命中、缺口、简历证据和可信度",
        input_schema=AnalyzeResumeGapArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = AnalyzeResumeGapArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("简历差距分析参数不合法", exc)
        job = get_job(payload.local_id, self._db_path)
        profile, _ = resolve_profile(payload.profile_id, self._db_path)
        if job is None or profile is None:
            message = "需要先保存候选人资料并导入岗位"
            return ToolResult(ok=False, status="failed", message=message, error=ToolError(code="local_context_missing", message=message))
        gap = analyze_gap(job, profile_for_agent(profile))
        return ToolResult(ok=True, status="done", data={"job": {"id": job["id"], "title": job["title"], "company": job["company"]}, "gap": gap}, message=f"已完成 {job['title']} 的简历差距分析")

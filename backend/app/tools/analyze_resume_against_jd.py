from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..profile_intelligence import analyze_gap
from .base import ToolContext
from .local_data import invalid_arguments, profile_for_agent, resolve_profile


class AnalyzeResumeAgainstJdArguments(BaseModel):
    job_description: str = Field(min_length=20, max_length=50_000)
    job_title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)


class AnalyzeResumeAgainstJdTool:
    definition = ToolDefinition(
        name="analyze_resume_against_jd",
        description=(
            "将当前上下文中的岗位 JD 与当前脱敏简历进行对比，"
            "返回技能命中、缺口、简历证据、可信度和分析限制"
        ),
        input_schema=AnalyzeResumeAgainstJdArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = AnalyzeResumeAgainstJdArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("JD 与简历分析参数不合法", exc)

        profile, preferences = resolve_profile(None, self._db_path)
        if profile is None:
            message = "尚未配置候选人简历，无法进行 JD 匹配分析"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="candidate_profile_missing", message=message),
            )

        safe_profile = profile_for_agent(profile)
        gap = analyze_gap(
            {
                "title": payload.job_title,
                "description": payload.job_description,
                "experience": "",
                "education": "",
            },
            safe_profile,
        )
        return ToolResult(
            ok=True,
            status="done",
            data={
                "job_context": {
                    "title": payload.job_title,
                    "company": payload.company,
                    "source": "conversation_job_description",
                    "character_count": len(payload.job_description),
                },
                "analysis": gap,
                "profile": {
                    "skills": safe_profile.get("skills", []),
                    "resume_privacy": safe_profile.get("resume_privacy", {}),
                },
                "persistence": "not_saved_as_job",
            },
            message="已将当前岗位 JD 与当前脱敏简历完成对比",
        )

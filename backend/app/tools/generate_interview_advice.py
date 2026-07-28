from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..profile_intelligence import analyze_gap
from .base import ToolContext
from .local_data import invalid_arguments, profile_for_agent, resolve_profile


class GenerateInterviewAdviceArguments(BaseModel):
    job_description: str = Field(min_length=20, max_length=50_000)
    job_title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    interview_type: Literal["general", "hr", "business", "technical", "final"] = "general"
    focus: list[str] = Field(default_factory=list, max_length=10)


class GenerateInterviewAdviceTool:
    definition = ToolDefinition(
        name="generate_interview_advice",
        description=(
            "读取当前脱敏简历并结合用户本轮提供的 JD，准备个人化面试建议所需上下文；"
            "调用后必须输出自我介绍、问题预测、回答方向、可讲述经历、反向提问和准备清单"
        ),
        input_schema=GenerateInterviewAdviceArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = GenerateInterviewAdviceArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("面试建议生成参数不合法", exc)

        profile, preferences = resolve_profile(None, self._db_path)
        if profile is None:
            message = "尚未保存简历画像，请先上传简历截图并保存识别结果"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="candidate_profile_missing", message=message),
            )

        safe_profile = profile_for_agent(profile)
        resume_text = str(safe_profile.get("resume_text") or "").strip()
        if not resume_text:
            message = "当前人物画像没有可用简历文本，请先上传简历截图并保存识别结果"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="resume_text_missing", message=message),
            )

        job = {
            "title": payload.job_title,
            "description": payload.job_description,
            "experience": "",
            "education": "",
        }
        return ToolResult(
            ok=True,
            status="done",
            data={
                "job_context": {
                    "title": payload.job_title,
                    "company": payload.company,
                    "description": payload.job_description,
                },
                "resume_source": resume_text,
                "profile_skills": safe_profile.get("skills", []),
                "preferences": preferences or {},
                "match_analysis": analyze_gap(job, safe_profile),
                "interview_options": {
                    "interview_type": payload.interview_type,
                    "focus": payload.focus,
                },
                "required_sections": [
                    "候选人定位",
                    "自我介绍框架",
                    "核心卖点",
                    "可能问题、提问原因和回答方向",
                    "可讲述的 STAR 经历",
                    "技术与业务准备主题",
                    "岗位缺口应对",
                    "向面试官提出的问题",
                    "面试前检查清单",
                ],
            },
            message="已准备目标 JD、当前脱敏简历和匹配信息，可生成个人化面试建议",
        )

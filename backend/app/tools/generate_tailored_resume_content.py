from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..profile.intelligence import analyze_gap
from .base import ToolContext
from .local_data import invalid_arguments, profile_for_agent, resolve_profile


class GenerateTailoredResumeContentArguments(BaseModel):
    job_description: str = Field(min_length=20, max_length=50_000)
    job_title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    target_language: str = Field(default="zh-CN", max_length=20)
    style: Literal["professional", "concise", "technical"] = "professional"
    length: Literal["concise", "standard", "detailed"] = "standard"
    focus: list[str] = Field(default_factory=list, max_length=10)


class GenerateTailoredResumeContentTool:
    definition = ToolDefinition(
        name="generate_tailored_resume_content",
        description=(
            "读取当前脱敏简历并结合用户本轮提供的 JD，准备一份完整、高匹配、可直接复制的"
            "简历文本。调用后必须依据工具返回的简历原文、匹配结果和输出要求生成完整内容；"
            "只返回文本，不生成 DOCX 或 PDF 文件"
        ),
        input_schema=GenerateTailoredResumeContentArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = GenerateTailoredResumeContentArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("定制简历内容生成参数不合法", exc)

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
                "generation_options": {
                    "target_language": payload.target_language,
                    "style": payload.style,
                    "length": payload.length,
                    "focus": payload.focus,
                },
                "required_sections": [
                    "目标岗位或简历标题",
                    "职业概要",
                    "核心能力",
                    "工作经历",
                    "项目经历",
                    "教育与证书（原简历存在时）",
                    "关键词覆盖与剩余缺口",
                ],
                "generation_rules": [
                    "输出完整、可直接复制的简历文本，不只给修改建议",
                    "优先展示与 JD 最相关的经历、项目和技能",
                    "保持原简历中的公司、职位、时间和项目主体不变",
                    "不生成 DOCX、PDF、下载链接或文件说明",
                ],
            },
            message="已准备目标 JD、当前脱敏简历和匹配信息，可生成完整定制简历文本",
        )

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..db import connect, json_dump, row_to_dict
from ..domain import ToolDefinition, ToolError, ToolResult
from .base import ToolContext
from .local_data import get_job, invalid_arguments, resolve_profile


class AnalyzeJobArguments(BaseModel):
    local_id: int = Field(ge=1)
    profile_id: int | None = Field(default=None, ge=1)


class AnalyzeJobTool:
    definition = ToolDefinition(
        name="analyze_job",
        description=(
            "结合本地候选人画像、求职偏好和已采集岗位详情进行匹配分析，"
            "并把评分、理由和风险保存到本地"
        ),
        input_schema=AnalyzeJobArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = AnalyzeJobArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("岗位分析参数不合法", exc)
        job = get_job(payload.local_id, self._db_path)
        if job is None:
            return self._missing("job_not_found", "本地岗位不存在")
        profile, preferences = resolve_profile(payload.profile_id, self._db_path)
        if profile is None:
            return self._missing(
                "candidate_profile_missing",
                "尚未配置候选人画像，无法进行个性化岗位分析",
            )

        score, level, reasons, risks = self._score(job, profile, preferences or {})
        suggested_angle = self._suggested_angle(profile, job)
        with connect(self._db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO match_results (
                    job_id, profile_id, score, level, reasons_json, risks_json, suggested_angle
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job["id"],
                    profile["id"],
                    score,
                    level,
                    json_dump(reasons),
                    json_dump(risks),
                    suggested_angle,
                ),
            )
            row = conn.execute(
                "SELECT * FROM match_results WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
        result = row_to_dict(row)
        return ToolResult(
            ok=True,
            status="done",
            data={"job": job, "match": result},
            message=f"已分析岗位：{job['title']}，匹配分 {score}",
        )

    @staticmethod
    def _missing(code: str, message: str) -> ToolResult:
        return ToolResult(
            ok=False,
            status="failed",
            message=message,
            error=ToolError(code=code, message=message),
        )

    @staticmethod
    def _score(
        job: dict[str, Any],
        profile: dict[str, Any],
        preferences: dict[str, Any],
    ) -> tuple[int, str, list[str], list[str]]:
        job_text = " ".join(
            str(job.get(key) or "")
            for key in ("title", "description", "industry", "company", "city", "district")
        ).lower()
        raw = job.get("raw") or {}
        job_text = f"{job_text} {' '.join(raw.get('tags', []))}".lower()
        skills = [str(item) for item in profile.get("skills", []) if str(item).strip()]
        roles = [str(item) for item in preferences.get("target_roles", [])]
        cities = [str(item).removesuffix("市") for item in preferences.get("target_cities", [])]
        blocked_keywords = [str(item) for item in preferences.get("blocked_keywords", [])]
        blocked_companies = [str(item) for item in preferences.get("blocked_companies", [])]

        score = 35
        reasons: list[str] = []
        risks: list[str] = []
        matched_skills = [skill for skill in skills if skill.lower() in job_text]
        if matched_skills:
            score += min(30, len(matched_skills) * 8)
            reasons.append(f"技能命中：{'、'.join(matched_skills[:6])}")
        if any(role.lower() in job["title"].lower() for role in roles if role):
            score += 20
            reasons.append("目标岗位方向匹配")
        location = f"{job.get('city', '')}{job.get('district', '')}"
        if any(city and city in location for city in cities):
            score += 10
            reasons.append("工作城市符合偏好")

        salary_min = preferences.get("salary_min")
        job_salary_max = job.get("salary_max")
        if salary_min and job_salary_max is not None:
            if job_salary_max >= salary_min:
                score += 5
                reasons.append("岗位薪资范围覆盖期望下限")
            else:
                score -= 20
                risks.append("岗位薪资上限低于期望下限")

        company = str(job.get("company") or "")
        for blocked in blocked_companies:
            if blocked and blocked.lower() in company.lower():
                score -= 50
                risks.append(f"命中屏蔽公司：{blocked}")
        for blocked in blocked_keywords:
            if blocked and blocked.lower() in job_text:
                score -= 25
                risks.append(f"命中屏蔽关键词：{blocked}")
        for keyword, risk in (
            ("外包", "疑似外包岗位"),
            ("培训", "疑似培训或招生岗位"),
            ("押金", "岗位内容涉及押金"),
            ("贷款", "岗位内容涉及贷款"),
        ):
            if keyword in job_text and risk not in risks:
                score -= 15
                risks.append(risk)

        if not job.get("description"):
            risks.append("尚未读取完整岗位描述，分析可信度有限")
        if not reasons:
            reasons.append("当前画像与岗位没有明显匹配证据")
        score = max(0, min(100, score))
        level = "recommended" if score >= 75 else "consider" if score >= 55 else "skip"
        return score, level, reasons, risks

    @staticmethod
    def _suggested_angle(profile: dict[str, Any], job: dict[str, Any]) -> str:
        skills = [
            str(skill)
            for skill in profile.get("skills", [])
            if str(skill).lower() in f"{job.get('title', '')} {job.get('description', '')}".lower()
        ]
        if skills:
            return f"优先突出与岗位相关的技能：{'、'.join(skills[:3])}"
        return "优先说明与岗位职责最接近的项目经历，并询问团队当前核心需求"

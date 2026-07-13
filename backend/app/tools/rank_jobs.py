from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..domain import JobMatch, JobSummary, ToolDefinition, ToolError, ToolResult
from .base import ToolContext


class RankJobsArguments(BaseModel):
    platform: str
    jobs: list[JobSummary]
    keywords: list[str] = Field(default_factory=list)
    cities: list[str] = Field(default_factory=list)


class RankJobsTool:
    definition = ToolDefinition(
        name="rank_jobs",
        description="根据搜索关键词、地点和岗位信息进行确定性匹配排序",
        input_schema=RankJobsArguments.model_json_schema(),
    )

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = RankJobsArguments.model_validate(arguments)
        except ValidationError as exc:
            return ToolResult(
                ok=False,
                status="failed",
                message="岗位排序参数不合法",
                error=ToolError(code="invalid_arguments", message=str(exc)),
            )

        matches = [self._score(job, payload.keywords, payload.cities) for job in payload.jobs]
        matches.sort(key=lambda item: item.score, reverse=True)
        return ToolResult(
            ok=True,
            status="done",
            data={
                "platform": payload.platform,
                "matches": [match.model_dump(mode="json") for match in matches],
            },
            message=f"已完成 {len(matches)} 个岗位的确定性匹配排序",
        )

    @staticmethod
    def _tokens(keywords: list[str]) -> list[str]:
        text = " ".join(keywords).lower()
        tokens = re.findall(r"[a-z0-9+#.]{2,}|[\u4e00-\u9fff]{2,}", text)
        return list(dict.fromkeys(tokens))

    @classmethod
    def _score(cls, job: JobSummary, keywords: list[str], cities: list[str]) -> JobMatch:
        score = 40
        reasons: list[str] = []
        risks: list[str] = []
        title = job.title.lower()
        tags = " ".join(job.tags).lower()
        matched_title = [token for token in cls._tokens(keywords) if token in title]
        matched_tags = [token for token in cls._tokens(keywords) if token in tags]

        if matched_title:
            points = min(40, len(matched_title) * 20)
            score += points
            reasons.append(f"标题命中：{'、'.join(matched_title)}")
        if matched_tags:
            points = min(15, len(matched_tags) * 8)
            score += points
            reasons.append(f"技能标签命中：{'、'.join(matched_tags)}")
        if any(city in job.location for city in cities):
            score += 10
            reasons.append("工作地点符合要求")
        if job.salary and job.salary.minimum is not None:
            score += 5
            reasons.append("薪资信息完整")

        risk_text = f"{job.title} {job.company}"
        if "外包" in risk_text:
            risks.append("疑似外包岗位")
            score -= 15
        if "培训" in risk_text:
            risks.append("疑似培训相关岗位")
            score -= 15

        score = max(0, min(100, score))
        level = "recommended" if score >= 75 else "consider" if score >= 55 else "skip"
        if not reasons:
            reasons.append("暂无明显关键词命中")
        return JobMatch(
            job=job,
            score=score,
            level=level,
            reasons=reasons,
            risks=risks,
        )

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


ToolRisk = Literal[
    "read_only",
    "derived_analysis",
    "local_pending_write",
    "confirmed_local_write",
    "external_read",
]


class ToolSpec(BaseModel):
    """Runtime policy and discovery metadata for one registered tool."""

    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1)
    title: str = Field(min_length=1)
    risk: ToolRisk
    capabilities: frozenset[str] = Field(min_length=1)
    priority: int = Field(default=100, ge=0)
    stage_id: str | None = None
    timeout_seconds: float | None = Field(default=None, gt=0)

    @property
    def requires_confirmation(self) -> bool:
        return self.risk == "confirmed_local_write"


def _spec(
    name: str,
    title: str,
    risk: ToolRisk,
    *capabilities: str,
    priority: int = 100,
    stage_id: str | None = None,
    timeout_seconds: float | None = None,
) -> ToolSpec:
    return ToolSpec(
        name=name,
        title=title,
        risk=risk,
        capabilities=frozenset(capabilities),
        priority=priority,
        stage_id=stage_id,
        timeout_seconds=timeout_seconds,
    )


TOOL_SPECS: dict[str, ToolSpec] = {
    "analyze_resume_against_jd": _spec(
        "analyze_resume_against_jd",
        "对比 JD 与当前简历",
        "derived_analysis",
        "document.analyze",
        "candidate.match",
        priority=10,
        stage_id="job_evaluation",
    ),
    "search_resume_evidence": _spec(
        "search_resume_evidence",
        "检索简历真实证据",
        "read_only",
        "document.search",
        "candidate.evidence",
        priority=10,
        stage_id="candidate_knowledge",
    ),
    "generate_tailored_resume_content": _spec(
        "generate_tailored_resume_content",
        "生成高匹配简历内容",
        "derived_analysis",
        "document.generate",
        "candidate.material",
        priority=10,
        stage_id="material_preparation",
    ),
    "generate_interview_advice": _spec(
        "generate_interview_advice",
        "生成个人化面试建议",
        "derived_analysis",
        "advice.generate",
        "candidate.advice",
        priority=10,
        stage_id="interview_preparation",
    ),
    "research_company": _spec(
        "research_company",
        "搜索并核验公开公司资料",
        "external_read",
        "web.search",
        "company.research",
        stage_id="job_evaluation",
    ),
    "search_public_web": _spec(
        "search_public_web",
        "搜索公开互联网资料",
        "external_read",
        "web.search",
        "web.search.generic",
        stage_id="job_evaluation",
    ),
    "get_candidate_context": _spec(
        "get_candidate_context",
        "装配最小候选人上下文",
        "read_only",
        "context.read",
        "candidate.context",
        stage_id="candidate_knowledge",
    ),
    "search_candidate_evidence": _spec(
        "search_candidate_evidence",
        "检索已确认候选人证据",
        "read_only",
        "memory.search",
        "candidate.evidence",
        priority=20,
        stage_id="candidate_knowledge",
    ),
    "propose_candidate_knowledge": _spec(
        "propose_candidate_knowledge",
        "创建待确认候选人知识",
        "local_pending_write",
        "memory.propose",
        "candidate.memory",
        stage_id="candidate_knowledge",
    ),
    "start_profile_interview": _spec(
        "start_profile_interview",
        "开始或恢复对话式画像访谈",
        "local_pending_write",
        "dialog.start",
        "candidate.interview",
        stage_id="candidate_knowledge",
    ),
    "record_profile_interview_answer": _spec(
        "record_profile_interview_answer",
        "记录画像访谈回答",
        "local_pending_write",
        "dialog.record",
        "candidate.interview",
        stage_id="candidate_knowledge",
    ),
    "pause_profile_interview": _spec(
        "pause_profile_interview",
        "暂停对话式画像访谈",
        "local_pending_write",
        "dialog.pause",
        "candidate.interview",
        stage_id="candidate_knowledge",
    ),
    "analyze_job_against_strategy": _spec(
        "analyze_job_against_strategy",
        "按职业策略分析岗位",
        "derived_analysis",
        "entity.analyze",
        "candidate.match",
        priority=20,
        stage_id="job_evaluation",
    ),
    "generate_candidate_material": _spec(
        "generate_candidate_material",
        "生成可信候选人材料",
        "derived_analysis",
        "document.generate",
        "candidate.material",
        "candidate.advice",
        priority=20,
        stage_id="material_preparation",
    ),
    "record_interview_debrief": _spec(
        "record_interview_debrief",
        "记录面试复盘",
        "local_pending_write",
        "memory.propose",
        "candidate.debrief",
        stage_id="outcome_tracking",
    ),
    "create_job_evaluation": _spec(
        "create_job_evaluation",
        "生成完整岗位决策报告",
        "external_read",
        "entity.research",
        "report.generate",
        stage_id="job_evaluation",
    ),
    "get_job_evaluation": _spec(
        "get_job_evaluation",
        "读取岗位决策报告",
        "read_only",
        "report.read",
        stage_id="job_evaluation",
    ),
    "review_job_evaluation": _spec(
        "review_job_evaluation",
        "审核岗位决策报告",
        "confirmed_local_write",
        "report.review",
        stage_id="job_evaluation",
    ),
    "compare_job_evaluations": _spec(
        "compare_job_evaluations",
        "比较完整岗位评估",
        "derived_analysis",
        "report.compare",
        stage_id="job_evaluation",
    ),
    "ask_user": _spec(
        "ask_user",
        "向用户确认不明确的信息",
        "read_only",
        "interaction.clarify",
    ),
}

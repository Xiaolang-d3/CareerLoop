from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..profile.candidate_core import (
    ensure_profile,
    get_candidate_context,
    list_facts,
    propose_fact,

    verify_candidate_material,
)
from ..profile.career_feedback import record_interview_debrief
from ..domain import ToolDefinition, ToolError, ToolResult
from ..jobs.evaluations import (
    create_job_comparison,
    create_job_evaluation,
    execute_job_evaluation,
    get_job_evaluation,
    review_job_evaluation,
)
from ..profile.intelligence import extract_skills
from .base import ToolContext
from .local_data import invalid_arguments, tool_error_boundary


class CandidateContextArguments(BaseModel):
    scope: Literal["triage", "match", "resume", "interview", "outreach", "coaching", "discovery"]
    strategy_id: int | None = Field(default=None, ge=1)


class GetCandidateContextTool:
    definition = ToolDefinition(
        name="get_candidate_context",
        description="按任务和职业策略读取最小候选人上下文；正式任务只返回已确认事实。",
        input_schema=CandidateContextArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    @tool_error_boundary("无法装配候选人上下文")
    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        payload = CandidateContextArguments.model_validate(arguments)
        data = get_candidate_context(
            payload.scope, strategy_id=payload.strategy_id, db_path=self._db_path
        )
        return ToolResult(ok=True, status="done", data=data, message="已装配最小候选人上下文")


class SearchEvidenceArguments(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    include_pending: bool = False
    limit: int = Field(default=8, ge=1, le=20)


def _tokens(text: str) -> set[str]:
    return {
        token.lower()
        for token in re.findall(r"[A-Za-z][A-Za-z0-9+#.-]{1,}|[\u4e00-\u9fff]{2,}", text)
    }


class SearchCandidateEvidenceTool:
    definition = ToolDefinition(
        name="search_candidate_evidence",
        description="检索已确认事实、来源摘录和故事；待确认内容默认不返回。",
        input_schema=SearchEvidenceArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    @tool_error_boundary("无法检索候选人证据")
    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        payload = SearchEvidenceArguments.model_validate(arguments)
        facts = list_facts(status="confirmed", db_path=self._db_path)
        if payload.include_pending:
            facts += list_facts(status="pending", db_path=self._db_path)
        query_tokens = _tokens(payload.query)
        ranked = []
        for fact in facts:
            evidence_text = " ".join(str(item.get("excerpt") or "") for item in fact.get("evidence", []))
            score = len(query_tokens & _tokens(f"{fact['statement']} {evidence_text}"))
            if score or payload.query.lower() in fact["statement"].lower():
                ranked.append((score, fact))
        matches = [item for _, item in sorted(ranked, key=lambda pair: (pair[0], pair[1]["id"]), reverse=True)[:payload.limit]]
        return ToolResult(
            ok=True,
            status="done",
            data={"query": payload.query, "evidence": matches, "formal_use": "confirmed_only"},
            message=f"找到 {len(matches)} 条候选人证据",
        )


class KnowledgeItem(BaseModel):
    category: str = Field(min_length=1, max_length=50)
    statement: str = Field(min_length=1, max_length=5000)
    source_id: int | None = Field(default=None, ge=1)
    excerpt: str = Field(default="", max_length=5000)


class ProposeKnowledgeArguments(BaseModel):
    items: list[KnowledgeItem] = Field(min_length=1, max_length=50)


class ProposeCandidateKnowledgeTool:
    definition = ToolDefinition(
        name="propose_candidate_knowledge",
        description=(
            "从当前画像维护对话创建待确认事实；不会直接确认或影响正式材料。"
            "支持一次调用提交多条知识（如简历中的基础信息、求职方向、技能、经历、教育背景），"
            "应在同一次调用的 items 数组中一并提交，避免逐条分别调用。"
        ),
        input_schema=ProposeKnowledgeArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    @tool_error_boundary("无法创建待确认知识")
    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        payload = ProposeKnowledgeArguments.model_validate(arguments)
        ensure_profile(self._db_path)
        # propose_fact 会立即落盘；批量提交时先校验全部条目非空，避免中途某条报错
        # 导致前面已经写入的条目和未处理的条目状态不一致。
        for item in payload.items:
            if not item.statement.strip():
                raise ValueError("事实内容不能为空")
        proposals = [
            propose_fact(
                category=item.category,
                statement=item.statement,
                source_id=item.source_id,
                excerpt=item.excerpt,
                extraction_method="main_chat",
                confidence=1.0 if item.source_id is None else 0.8,
                db_path=self._db_path,
            )
            for item in payload.items
        ]
        return ToolResult(
            ok=True, status="done", data={"proposals": proposals},
            message=f"已加入 {len(proposals)} 条待确认知识；确认前不会影响正式评分或材料",
        )


class AnalyzeStrategyArguments(BaseModel):
    job_description: str = Field(min_length=20, max_length=50000)
    strategy_id: int | None = Field(default=None, ge=1)
    job_title: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)


class AnalyzeJobAgainstStrategyTool:
    definition = ToolDefinition(
        name="analyze_job_against_strategy",
        description="使用指定职业策略和已确认事实分析岗位；待确认事实只作为追问提示，不计入匹配分。",
        input_schema=AnalyzeStrategyArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    @tool_error_boundary("无法按职业策略分析岗位")
    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        payload = AnalyzeStrategyArguments.model_validate(arguments)
        candidate = get_candidate_context("match", strategy_id=payload.strategy_id, db_path=self._db_path)
        job_skills = extract_skills(payload.job_description)
        fact_text = " ".join(item["statement"] for item in candidate["confirmed_facts"])
        fact_skills = set(extract_skills(fact_text, blocked=candidate.get("blocked_claims")))
        matched = [skill for skill in job_skills if skill in fact_skills]
        missing = [skill for skill in job_skills if skill not in fact_skills]
        score = round(len(matched) / len(job_skills) * 100) if job_skills else 0
        return ToolResult(
            ok=True, status="done",
            data={
                "job": {"title": payload.job_title, "company": payload.company},
                "strategy": candidate.get("strategy"), "score": score,
                "matched_skills": matched, "evidence_gaps": missing,
                "confirmed_facts": candidate["confirmed_facts"],
                "pending_hints": candidate.get("pending_hints", []),
                "context_fingerprint": candidate["fingerprint"],
                "knowledge_revision": candidate["profile"]["knowledge_revision"],
                "scoring_rule": "只有已确认事实进入分数",
            },
            message="已按职业策略和已确认事实完成岗位分析",
        )


class GenerateMaterialArguments(BaseModel):
    material_type: Literal["resume", "self_intro", "interview_answer", "outreach"]
    strategy_id: int | None = Field(default=None, ge=1)
    job_description: str = Field(default="", max_length=50000)
    prompt: str = Field(default="", max_length=5000)
    draft_to_verify: str = Field(default="", max_length=100000)


class GenerateCandidateMaterialTool:
    definition = ToolDefinition(
        name="generate_candidate_material",
        description="为简历、自我介绍、面试回答或沟通草稿提供最小可信上下文和事实门结果。",
        input_schema=GenerateMaterialArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    @tool_error_boundary("候选人材料生成上下文无法准备")
    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        payload = GenerateMaterialArguments.model_validate(arguments)
        scope = {
            "resume": "resume", "self_intro": "interview",
            "interview_answer": "interview", "outreach": "outreach",
        }[payload.material_type]
        candidate = get_candidate_context(scope, strategy_id=payload.strategy_id, db_path=self._db_path)
        gate = verify_candidate_material(payload.draft_to_verify, db_path=self._db_path) if payload.draft_to_verify else None
        return ToolResult(
            ok=True, status="done",
            data={
                "material_type": payload.material_type, "candidate_context": candidate,
                "job_description": payload.job_description, "request": payload.prompt,
                "fact_gate": gate,
                "generation_rules": [
                    "只陈述 confirmed_facts 中有证据支持的事实",
                    "不得使用 blocked_claims，禁止把 pending 内容写入正式材料",
                    "定稿前再次调用事实安全门；未通过时只能标记为预览",
                ],
            },
            message="已准备可信材料上下文和定稿规则",
        )


class InterviewDebriefArguments(BaseModel):
    job_id: int = Field(ge=1)
    summary: str = Field(default="", max_length=10000)
    questions: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    feedback_verbatim: str = Field(default="", max_length=10000)
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)


class RecordInterviewDebriefTool:
    definition = ToolDefinition(
        name="record_interview_debrief",
        description="记录真实面试问题、原回答和反馈，并只生成待确认的事实或故事建议。",
        input_schema=InterviewDebriefArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    @tool_error_boundary("无法记录面试复盘")
    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        payload = InterviewDebriefArguments.model_validate(arguments)
        debrief = record_interview_debrief(
            payload.job_id, summary=payload.summary, questions=payload.questions,
            strengths=payload.strengths, gaps=payload.gaps,
            feedback_verbatim=payload.feedback_verbatim, db_path=self._db_path,
        )
        return ToolResult(ok=True, status="done", data={"debrief": debrief}, message="面试复盘已保存，新知识仍待确认")


class CreateJobEvaluationArguments(BaseModel):
    job_id: int = Field(ge=1)
    strategy_id: int | None = Field(default=None, ge=1)
    include_public_research: bool = True


class CreateJobEvaluationTool:
    definition = ToolDefinition(
        name="create_job_evaluation",
        description="为已保存的岗位项目生成完整 A–G 决策报告；公开研究最多使用 5 次搜索。",
        input_schema=CreateJobEvaluationArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = CreateJobEvaluationArguments.model_validate(arguments)
            evaluation = create_job_evaluation(
                payload.job_id, strategy_id=payload.strategy_id,
                include_public_research=payload.include_public_research, db_path=self._db_path,
            )
            result = await asyncio.to_thread(
                execute_job_evaluation, int(evaluation["id"]), db_path=self._db_path,
            )
        except (ValidationError, ValueError) as exc:
            return invalid_arguments("无法生成岗位决策报告", exc)
        return ToolResult(
            ok=result["status"] in {"completed", "partial_failed"}, status="done",
            data={"evaluation": result},
            message="岗位 A–G 决策报告已生成" if result["status"] == "completed" else "已保存本地可完成的岗位报告，研究限制已标明",
        )


class GetJobEvaluationArguments(BaseModel):
    evaluation_id: int = Field(ge=1)


class GetJobEvaluationTool:
    definition = ToolDefinition(
        name="get_job_evaluation",
        description="读取一份岗位决策报告、评分、风险、来源限制和过期状态。",
        input_schema=GetJobEvaluationArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = GetJobEvaluationArguments.model_validate(arguments)
            result = get_job_evaluation(payload.evaluation_id, db_path=self._db_path)
        except (ValidationError, ValueError) as exc:
            return invalid_arguments("无法读取岗位决策报告", exc)
        return ToolResult(ok=True, status="done", data={"evaluation": result}, message="已读取岗位决策报告")


class ReviewJobEvaluationArguments(BaseModel):
    evaluation_id: int = Field(ge=1)
    target_type: Literal["requirement", "dimension", "risk", "compensation"]
    target_key: str = Field(min_length=1, max_length=100)
    action: Literal["confirm", "edit", "reject", "resolve", "restore"]
    override: dict[str, Any] = Field(default_factory=dict)
    note: str = Field(default="", max_length=2000)


class ReviewJobEvaluationTool:
    definition = ToolDefinition(
        name="review_job_evaluation",
        description="按用户明确指令保存岗位评估审核；保留系统原判，能力匹配提升必须引用已确认事实。",
        input_schema=ReviewJobEvaluationArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = ReviewJobEvaluationArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("岗位审核参数不合法", exc)
        if not any(word in context.user_content for word in ("确认", "修改", "驳回", "解决", "恢复", "审核")):
            message = "未检测到用户本轮对岗位审核的明确指令，系统原判保持不变"
            return ToolResult(
                ok=False, status="waiting_approval", message=message,
                error=ToolError(code="explicit_confirmation_required", message=message),
                data={
                    "clarification": {
                        "question": message,
                        "options": [
                            {"id": "opt_1", "label": "确认审核", "send": "确认审核刚才的岗位评估"},
                            {"id": "opt_2", "label": "先不改", "send": "先不审核，保持系统原判"},
                        ],
                        "allow_custom": True,
                    }
                },
            )
        try:
            result = review_job_evaluation(
                payload.evaluation_id, target_type=payload.target_type,
                target_key=payload.target_key, action=payload.action,
                override=payload.override, note=payload.note, db_path=self._db_path,
            )
        except ValueError as exc:
            return invalid_arguments("岗位审核保存失败", exc)
        return ToolResult(ok=True, status="done", data={"evaluation": result}, message="岗位审核已保存，系统原判仍可追溯")


class CompareJobEvaluationsArguments(BaseModel):
    evaluation_ids: list[int] = Field(min_length=2, max_length=10)


class CompareJobEvaluationsTool:
    definition = ToolDefinition(
        name="compare_job_evaluations",
        description="比较 2–10 份同一职业策略和权重版本下的完整岗位评估。",
        input_schema=CompareJobEvaluationsArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = CompareJobEvaluationsArguments.model_validate(arguments)
            result = create_job_comparison(payload.evaluation_ids, db_path=self._db_path)
        except (ValidationError, ValueError) as exc:
            return invalid_arguments("岗位比较失败", exc)
        return ToolResult(ok=True, status="done", data={"comparison": result}, message="岗位比较快照已生成")

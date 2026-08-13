"""求职流程阶段定义：新增业务时只需修改本文件。

阶段归属的主依据是 `orchestration.route_task()` 产出的 `route.kind`——它表达用户
意图，不随新旧工具变体（如 `analyze_resume_against_jd` 与
`analyze_job_against_strategy`）改变。工具名映射作为补充信号，用于在同一阶段内
累计具体完成次数。
"""

from __future__ import annotations


# 有序阶段：(stage_id, 展示标题, 未完成时的提示语)
STAGE_DEFS: tuple[tuple[str, str, str], ...] = (
    ("candidate_knowledge", "候选人画像与知识", "先补充经历与能力，后续分析都依赖这些已确认事实"),
    ("opportunity_discovery", "机会发现", "发现值得投递的公司与岗位"),
    ("job_evaluation", "岗位评估与决策", "对目标岗位做匹配分析或完整决策报告"),
    ("material_preparation", "求职材料准备", "生成高匹配简历内容与自我介绍"),
    ("interview_preparation", "面试准备", "准备面试问题、STAR 案例与反向提问"),
    ("outcome_tracking", "结果与复盘", "记录投递结果与面试复盘，沉淀为新的画像事实"),
)

STAGE_IDS: frozenset[str] = frozenset(stage_id for stage_id, _, _ in STAGE_DEFS)

STAGE_TITLES: dict[str, str] = {stage_id: title for stage_id, title, _ in STAGE_DEFS}


# route.kind -> stage_id；None 表示该轮不推进任何阶段。
# 键集合必须与 orchestration.ROUTE_LABELS 一致，由 test_workflow_stages.py 断言。
ROUTE_STAGES: dict[str, str | None] = {
    "conversation": None,
    "web_search": None,
    "jd_analysis": "job_evaluation",
    "resume_evidence": "candidate_knowledge",
    "profile_analysis": "candidate_knowledge",
    "project_story": "interview_preparation",
    "tailored_resume": "material_preparation",
    "interview_preparation": "interview_preparation",
    "career_package": "material_preparation",
    "company_research": "job_evaluation",
    "job_due_diligence": "job_evaluation",
    "profile_onboarding": "candidate_knowledge",
    "profile_enrichment": "candidate_knowledge",
    "career_strategy": "candidate_knowledge",
    "interview_debrief": "outcome_tracking",
    "opportunity_discovery": "opportunity_discovery",
    "skill_growth": "candidate_knowledge",
    "job_evaluation": "job_evaluation",
}


# 工具名 -> stage_id。键集合必须与 orchestration.TOOL_POLICIES 一致。
# 只收录真实工具；runtime 发出的合成事件名（agent_thinking / agent_planner /
# model_provider / citation_validator）不在此处，因而会被自动忽略。
TOOL_STAGES: dict[str, str] = {
    # 候选人画像与知识
    "search_resume_evidence": "candidate_knowledge",
    "get_candidate_context": "candidate_knowledge",
    "search_candidate_evidence": "candidate_knowledge",
    "propose_candidate_knowledge": "candidate_knowledge",
    "start_profile_interview": "candidate_knowledge",
    "record_profile_interview_answer": "candidate_knowledge",
    "pause_profile_interview": "candidate_knowledge",
    # 机会发现
    "discover_companies": "opportunity_discovery",
    "discover_funded_companies": "opportunity_discovery",
    "scan_career_sources": "opportunity_discovery",
    "process_opportunity_pipeline": "opportunity_discovery",
    # 岗位评估与决策
    "analyze_resume_against_jd": "job_evaluation",
    "analyze_job_against_strategy": "job_evaluation",
    "research_company": "job_evaluation",
    "search_public_web": "job_evaluation",
    "create_job_evaluation": "job_evaluation",
    "get_job_evaluation": "job_evaluation",
    "review_job_evaluation": "job_evaluation",
    "run_job_deep_research": "job_evaluation",
    "compare_job_evaluations": "job_evaluation",
    # 求职材料准备
    "generate_tailored_resume_content": "material_preparation",
    "generate_candidate_material": "material_preparation",
    # 面试准备
    "generate_interview_advice": "interview_preparation",
    # 结果与复盘
    "record_interview_debrief": "outcome_tracking",
}


def stage_for_route(kind: str | None) -> str | None:
    """把 route.kind 解析为阶段；未知 kind（如本地路由 workflow_status）返回 None。"""
    if not kind:
        return None
    return ROUTE_STAGES.get(kind)


def stage_for_tool(tool_name: str | None) -> str | None:
    """把工具名解析为阶段；合成事件名与未知工具返回 None。"""
    if not tool_name:
        return None
    return TOOL_STAGES.get(tool_name)


# 兼容旧 `counts` 响应键：旧键名 -> 派生来源 stage_id。
# 多个旧键可指向同一阶段（jd_analyses 与 company_researches 都出自 job_evaluation），
# 因此方向是 旧键 -> 阶段，不能反过来。
# 前端切换到 stage_counts 后可移除（消费者见 main.tsx / WorkspaceViews.tsx / e2e mock）。
LEGACY_COUNT_KEYS: dict[str, str] = {
    "jd_analyses": "job_evaluation",
    "resume_evidence_searches": "candidate_knowledge",
    "tailored_resume_generations": "material_preparation",
    "interview_advice_generations": "interview_preparation",
    "company_researches": "job_evaluation",
}

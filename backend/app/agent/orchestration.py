from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import ValidationError

from ..domain import AgentPlan, AgentPlanStep, ModelResponse


ToolRisk = Literal[
    "read_only", "derived_analysis", "local_pending_write",
    "confirmed_local_write", "external_read",
]


@dataclass(frozen=True)
class ToolPolicy:
    risk: ToolRisk
    title: str


TOOL_POLICIES: dict[str, ToolPolicy] = {
    "analyze_resume_against_jd": ToolPolicy("derived_analysis", "对比 JD 与当前简历"),
    "search_resume_evidence": ToolPolicy("read_only", "检索简历真实证据"),
    "generate_tailored_resume_content": ToolPolicy("derived_analysis", "生成高匹配简历内容"),
    "generate_interview_advice": ToolPolicy("derived_analysis", "生成个人化面试建议"),
    "research_company": ToolPolicy("external_read", "搜索并核验公开公司资料"),
    "search_public_web": ToolPolicy("external_read", "搜索公开互联网资料"),
    "get_candidate_context": ToolPolicy("read_only", "装配最小候选人上下文"),
    "search_candidate_evidence": ToolPolicy("read_only", "检索已确认候选人证据"),
    "propose_candidate_knowledge": ToolPolicy("local_pending_write", "创建待确认候选人知识"),
    "start_profile_interview": ToolPolicy("local_pending_write", "开始或恢复对话式画像访谈"),
    "record_profile_interview_answer": ToolPolicy("local_pending_write", "记录画像访谈回答"),
    "pause_profile_interview": ToolPolicy("local_pending_write", "暂停对话式画像访谈"),
    "analyze_job_against_strategy": ToolPolicy("derived_analysis", "按职业策略分析岗位"),
    "generate_candidate_material": ToolPolicy("derived_analysis", "生成可信候选人材料"),
    "record_interview_debrief": ToolPolicy("local_pending_write", "记录面试复盘"),
    "discover_companies": ToolPolicy("external_read", "发现适合的公司"),
    "discover_funded_companies": ToolPolicy("external_read", "发现近期融资公司"),
    "scan_career_sources": ToolPolicy("external_read", "扫描官方职位来源"),
    "process_opportunity_pipeline": ToolPolicy("derived_analysis", "评估发现岗位队列"),
    "create_job_evaluation": ToolPolicy("external_read", "生成完整岗位决策报告"),
    "get_job_evaluation": ToolPolicy("read_only", "读取岗位决策报告"),
    "review_job_evaluation": ToolPolicy("confirmed_local_write", "审核岗位决策报告"),
    "run_job_deep_research": ToolPolicy("external_read", "执行岗位深度研究"),
    "compare_job_evaluations": ToolPolicy("derived_analysis", "比较完整岗位评估"),
}


@dataclass(frozen=True)
class TaskRoute:
    kind: str
    needs_plan: bool
    allowed_tools: tuple[str, ...]


ROUTE_LABELS = {
    "conversation": "普通求职咨询",
    "jd_analysis": "JD 与简历匹配分析",
    "resume_evidence": "简历证据检索",
    "profile_analysis": "人物画像与竞争力分析",
    "project_story": "项目经历与面试表达梳理",
    "tailored_resume": "高匹配简历内容生成",
    "interview_preparation": "面试准备",
    "career_package": "完整求职准备",
    "company_research": "公司公开信息研究",
    "job_due_diligence": "岗位匹配与公司尽调",
    "web_search": "单轮联网搜索",
    "profile_onboarding": "对话式画像初始化",
    "profile_enrichment": "候选人知识补充",
    "career_strategy": "多职业策略维护",
    "interview_debrief": "面试复盘",
    "opportunity_discovery": "公司与岗位发现",
    "skill_growth": "能力成长分析",
    "job_evaluation": "岗位决策与评估",
}


def route_summary(route: TaskRoute) -> str:
    label = ROUTE_LABELS.get(route.kind, route.kind)
    if route.allowed_tools:
        return f"已识别为{label}，需要先规划并限制可用工具"
    return f"已识别为{label}，无需调用工具"


def route_task(
    content: str,
    available_tools: set[str],
    *,
    profile_interview_active: bool = False,
) -> TaskRoute:
    """Conservatively select a task lane and the smallest useful tool surface.

    ``profile_interview_active`` comes from stored session state, not from the
    message text: while an interview is running, any reply may be an answer to
    the current question, so the interview tools stay on the table and the model
    decides whether this turn is actually an answer.
    """
    text = " ".join(content.lower().split())
    tools: list[str] = []
    kind = "conversation"

    def add(*names: str) -> None:
        for name in names:
            if name in available_tools and name not in tools:
                tools.append(name)

    def add_preferred(preferred: str, fallback: str) -> None:
        add(preferred if preferred in available_tools else fallback)

    mentions_jd = any(word in text for word in ("岗位", "职位", "jd", "职位描述", "岗位要求"))
    asks_analysis = any(
        word in text
        for word in (
            "分析", "匹配", "适合", "评估", "差距", "缺口", "欠缺",
            "改进简历", "面试准备", "技能要求",
        )
    )
    asks_evidence = any(
        word in text
        for word in ("简历证据", "经历证据", "项目证据", "证明我", "真实经历", "简历里找")
    )
    asks_profile_analysis = any(
        phrase in text
        for phrase in (
            "我的优势", "我的短板", "我的弱点", "我的竞争力", "我的能力",
            "我的技能", "我的经历", "我的项目", "我的简历", "我的背景",
            "我擅长什么", "我适合什么", "我适合做什么", "职业方向",
            "求职方向", "简历诊断", "评估简历", "分析简历", "优化方向",
            "核心优势", "能力画像", "个人画像",
        )
    )
    asks_project_story = any(
        phrase in text
        for phrase in (
            "项目亮点", "梳理项目", "项目梳理", "项目复盘", "项目表达",
            "讲项目", "项目故事", "项目经历", "项目经验",
        )
    )
    asks_tailored_resume = any(
        word in text
        for word in (
            "定制简历", "定制一份简历", "生成简历", "简历内容", "改写简历",
            "优化简历", "高匹配简历", "匹配的简历",
        )
    )
    asks_interview = any(
        word in text
        for word in (
            "面试准备", "准备面试", "面试建议", "面试问题", "面试题",
            "自我介绍", "反向提问", "star",
        )
    )
    asks_explicit_web_search = any(
        phrase in text
        for phrase in (
            "联网搜索", "联网查", "网上搜索", "网上查", "帮我搜一下",
            "搜索一下", "上网搜", "上网查", "查一下最新",
        )
    )
    asks_company_research = any(
        phrase in text
        for phrase in (
            "公司背景", "公司信息", "公司情况", "公司怎么样", "公司靠谱吗",
            "调查公司", "研究公司", "了解公司", "公司调研", "背调公司",
            "公司风险", "公司新闻", "公司融资", "公司业务", "值得去吗",
        )
    ) or ("公司" in text and asks_explicit_web_search)
    trusted_web_search = "[系统可信开关：本轮允许联网搜索]" in content
    # Deliberately broad: this only admits the message into the profile lane and
    # widens the tool surface. Which tool to actually call is the model's decision.
    asks_profile_onboarding = any(
        phrase in text
        for phrase in (
            "初始化画像", "建立画像", "创建画像", "画像访谈", "开始了解我", "了解我",
            "完善画像", "我的画像", "保存我的信息", "介绍一下我自己", "自我介绍一下",
        )
    )
    asks_profile_enrichment = any(
        phrase in text
        for phrase in (
            "补充画像", "补充经历", "记住我的", "加入画像", "记录我的能力",
            "更新画像", "补充我的", "记录我的",
        )
    )
    asks_strategy = any(
        phrase in text for phrase in ("职业策略", "求职策略", "目标岗位方向", "薪资目标", "工作方式偏好")
    )
    asks_debrief = any(
        phrase in text for phrase in ("面试复盘", "复盘面试", "刚面试完", "面试官问了")
    )
    asks_discovery = any(
        phrase in text for phrase in (
            "发现适合的公司", "发现岗位", "找公司官网", "扫描职位来源", "刷新岗位来源",
            "融资公司", "近期融资", "批量评估", "岗位队列",
        )
    )
    asks_skill_growth = any(
        phrase in text for phrase in ("能力成长", "学习计划", "重复缺口", "技能成长")
    )
    asks_job_evaluation = any(
        phrase in text for phrase in (
            "完整评估", "岗位决策报告", "a-g", "深度研究", "比较岗位", "岗位比较", "审核评估",
        )
    )

    if asks_job_evaluation:
        kind = "job_evaluation"
        if any(phrase in text for phrase in ("比较岗位", "岗位比较")):
            add("compare_job_evaluations", "get_job_evaluation")
        elif "深度研究" in text:
            add("run_job_deep_research", "get_job_evaluation")
        elif any(phrase in text for phrase in ("审核评估", "确认风险", "驳回风险")):
            add("review_job_evaluation", "get_job_evaluation")
        else:
            add("create_job_evaluation", "get_job_evaluation")
    elif asks_debrief:
        kind = "interview_debrief"
        add("record_interview_debrief", "get_candidate_context")
    elif asks_discovery:
        kind = "opportunity_discovery"
        add("get_candidate_context")
        if any(phrase in text for phrase in ("融资公司", "近期融资")):
            add("discover_funded_companies")
        elif any(phrase in text for phrase in ("批量评估", "岗位队列", "处理队列")):
            add("process_opportunity_pipeline")
        elif any(phrase in text for phrase in ("扫描职位来源", "刷新岗位来源")):
            add("scan_career_sources")
        else:
            add("discover_companies")
    elif asks_profile_onboarding:
        kind = "profile_onboarding"
        add(
            "start_profile_interview",
            "record_profile_interview_answer",
            "pause_profile_interview",
            "get_candidate_context",
            "propose_candidate_knowledge",
        )
    elif asks_profile_enrichment:
        kind = "profile_enrichment"
        add(
            "record_profile_interview_answer",
            "start_profile_interview",
            "pause_profile_interview",
            "get_candidate_context",
            "propose_candidate_knowledge",
        )
    elif asks_strategy:
        kind = "career_strategy"
        add("get_candidate_context", "propose_candidate_knowledge")
    elif asks_skill_growth:
        kind = "skill_growth"
        add("get_candidate_context", "search_candidate_evidence")
    elif trusted_web_search and asks_company_research:
        kind = "company_research"
        add("research_company")
    elif trusted_web_search:
        kind = "web_search"
        add("search_public_web")
    elif asks_company_research and mentions_jd and asks_analysis:
        kind = "job_due_diligence"
        add_preferred("analyze_resume_against_jd", "analyze_job_against_strategy")
        add_preferred("search_resume_evidence", "search_candidate_evidence")
        add("research_company")
    elif asks_company_research:
        kind = "company_research"
        add("research_company")
    elif asks_explicit_web_search:
        kind = "web_search"
        add("search_public_web")
    elif asks_tailored_resume and asks_interview:
        kind = "career_package"
        add_preferred("analyze_resume_against_jd", "analyze_job_against_strategy")
        add_preferred("search_resume_evidence", "search_candidate_evidence")
        add_preferred("generate_tailored_resume_content", "generate_candidate_material")
        add("generate_interview_advice")
    elif asks_tailored_resume:
        kind = "tailored_resume"
        add_preferred("analyze_resume_against_jd", "analyze_job_against_strategy")
        add_preferred("search_resume_evidence", "search_candidate_evidence")
        add_preferred("generate_tailored_resume_content", "generate_candidate_material")
    elif asks_interview:
        kind = "interview_preparation"
        add_preferred("analyze_resume_against_jd", "analyze_job_against_strategy")
        add_preferred("search_resume_evidence", "search_candidate_evidence")
        add_preferred("generate_interview_advice", "generate_candidate_material")
    elif asks_project_story:
        kind = "project_story"
        add("get_candidate_context")
        add_preferred("search_resume_evidence", "search_candidate_evidence")
    elif mentions_jd and asks_analysis:
        kind = "jd_analysis"
        add_preferred("analyze_resume_against_jd", "analyze_job_against_strategy")
        add_preferred("search_resume_evidence", "search_candidate_evidence")
    elif asks_evidence:
        kind = "resume_evidence"
        add_preferred("search_resume_evidence", "search_candidate_evidence")
    elif asks_profile_analysis:
        kind = "profile_analysis"
        add_preferred("search_resume_evidence", "search_candidate_evidence")

    if profile_interview_active:
        # A running interview makes every reply a possible answer, whatever it
        # says. Keep the lane open unless the turn clearly belongs elsewhere.
        if kind == "conversation":
            kind = "profile_enrichment"
        add(
            "record_profile_interview_answer",
            "pause_profile_interview",
            "start_profile_interview",
        )

    return TaskRoute(kind=kind, needs_plan=bool(tools), allowed_tools=tuple(tools))


def fallback_plan(goal: str, route: TaskRoute) -> AgentPlan:
    steps = []
    for index, tool_name in enumerate(route.allowed_tools, start=1):
        policy = TOOL_POLICIES[tool_name]
        steps.append(
            AgentPlanStep(
                id=f"step-{index}",
                title=policy.title,
                tool_name=tool_name,
                risk=policy.risk,
            )
        )
    return AgentPlan(
        goal=goal.strip()[:300] or "完成当前求职任务",
        route=route.kind,
        steps=steps,
        requires_confirmation=any(step.risk == "confirmed_local_write" for step in steps),
    )


def planner_prompt(goal: str, route: TaskRoute) -> str:
    tool_lines = "\n".join(
        f"- {name}: {TOOL_POLICIES[name].title}，风险={TOOL_POLICIES[name].risk}"
        for name in route.allowed_tools
    )
    return f"""为下面的求职任务生成简短、可执行、可审计的 JSON 计划。
任务：{goal}
路由：{route.kind}
只允许使用以下工具：
{tool_lines}

返回且只返回 JSON：
{{"goal":"一句话目标","steps":[{{"tool_name":"工具名","title":"用户可理解的步骤"}}]}}
规则：按依赖顺序排列；不必使用所有工具；不得添加未列出的工具；不要输出思维过程。"""


def parse_plan(response: ModelResponse, goal: str, route: TaskRoute) -> AgentPlan:
    if response.tool_calls or not response.content.strip():
        return fallback_plan(goal, route)
    raw = response.content.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return fallback_plan(goal, route)

    allowed = set(route.allowed_tools)
    steps: list[AgentPlanStep] = []
    for item in payload.get("steps", []):
        tool_name = str(item.get("tool_name", ""))
        if tool_name not in allowed or tool_name in {step.tool_name for step in steps}:
            continue
        policy = TOOL_POLICIES[tool_name]
        try:
            step = AgentPlanStep(
                id=f"step-{len(steps) + 1}",
                title=str(item.get("title") or policy.title)[:100],
                tool_name=tool_name,
                risk=policy.risk,
            )
        except ValidationError:
            continue
        steps.append(step)
    required_by_route = {
        "company_research": ("research_company",),
        "web_search": ("search_public_web",),
        "job_due_diligence": ("analyze_job_against_strategy", "research_company"),
        "profile_analysis": ("search_candidate_evidence",),
        "project_story": ("get_candidate_context", "search_candidate_evidence"),
        "tailored_resume": ("generate_candidate_material",),
        "interview_preparation": ("generate_candidate_material",),
        "career_package": (
            "generate_candidate_material",
        ),
        "interview_debrief": ("record_interview_debrief",),
        "profile_onboarding": ("start_profile_interview",),
        "profile_enrichment": ("record_profile_interview_answer",),
        "opportunity_discovery": ("discover_companies",),
    }
    for tool_name in required_by_route.get(route.kind, ()):
        if tool_name not in allowed or tool_name in {step.tool_name for step in steps}:
            continue
        policy = TOOL_POLICIES[tool_name]
        steps.append(
            AgentPlanStep(
                id=f"step-{len(steps) + 1}",
                title=policy.title,
                tool_name=tool_name,
                risk=policy.risk,
            )
        )
    if not steps:
        return fallback_plan(goal, route)
    return AgentPlan(
        goal=str(payload.get("goal") or goal).strip()[:300],
        route=route.kind,
        steps=steps,
        requires_confirmation=any(step.risk == "confirmed_local_write" for step in steps),
    )

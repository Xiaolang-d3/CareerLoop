from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import ValidationError

from ..domain import AgentPlan, AgentPlanStep, ModelResponse


ToolRisk = Literal["read_only", "analysis", "local_write", "user_input"]


@dataclass(frozen=True)
class ToolPolicy:
    risk: ToolRisk
    title: str


TOOL_POLICIES: dict[str, ToolPolicy] = {
    "analyze_resume_against_jd": ToolPolicy("analysis", "对比 JD 与当前简历"),
    "search_resume_evidence": ToolPolicy("read_only", "检索简历真实证据"),
    "generate_tailored_resume_content": ToolPolicy("analysis", "生成高匹配简历内容"),
    "generate_interview_advice": ToolPolicy("analysis", "生成个人化面试建议"),
    "research_company": ToolPolicy("read_only", "搜索并核验公开公司资料"),
    "search_public_web": ToolPolicy("read_only", "搜索公开互联网资料"),
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
    "tailored_resume": "高匹配简历内容生成",
    "interview_preparation": "面试准备",
    "career_package": "完整求职准备",
    "company_research": "公司公开信息研究",
    "job_due_diligence": "岗位匹配与公司尽调",
    "web_search": "单轮联网搜索",
}


def route_summary(route: TaskRoute) -> str:
    label = ROUTE_LABELS.get(route.kind, route.kind)
    if route.allowed_tools:
        return f"已识别为{label}，需要先规划并限制可用工具"
    return f"已识别为{label}，无需调用工具"


def route_task(content: str, available_tools: set[str]) -> TaskRoute:
    """Conservatively select a task lane and the smallest useful tool surface."""
    text = " ".join(content.lower().split())
    tools: list[str] = []
    kind = "conversation"

    def add(*names: str) -> None:
        for name in names:
            if name in available_tools and name not in tools:
                tools.append(name)

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

    if trusted_web_search and asks_company_research:
        kind = "company_research"
        add("research_company")
    elif trusted_web_search:
        kind = "web_search"
        add("search_public_web")
    elif asks_company_research and mentions_jd and asks_analysis:
        kind = "job_due_diligence"
        add("analyze_resume_against_jd", "search_resume_evidence", "research_company")
    elif asks_company_research:
        kind = "company_research"
        add("research_company")
    elif asks_explicit_web_search:
        kind = "web_search"
        add("search_public_web")
    elif asks_tailored_resume and asks_interview:
        kind = "career_package"
        add(
            "analyze_resume_against_jd",
            "search_resume_evidence",
            "generate_tailored_resume_content",
            "generate_interview_advice",
        )
    elif asks_tailored_resume:
        kind = "tailored_resume"
        add(
            "analyze_resume_against_jd",
            "search_resume_evidence",
            "generate_tailored_resume_content",
        )
    elif asks_interview:
        kind = "interview_preparation"
        add(
            "analyze_resume_against_jd",
            "search_resume_evidence",
            "generate_interview_advice",
        )
    elif mentions_jd and asks_analysis:
        kind = "jd_analysis"
        add("analyze_resume_against_jd", "search_resume_evidence")
    elif asks_evidence:
        kind = "resume_evidence"
        add("search_resume_evidence")
    elif asks_profile_analysis:
        kind = "profile_analysis"
        add("search_resume_evidence")

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
        requires_confirmation=any(step.risk == "user_input" for step in steps),
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
        "job_due_diligence": ("analyze_resume_against_jd", "research_company"),
        "profile_analysis": ("search_resume_evidence",),
        "tailored_resume": ("generate_tailored_resume_content",),
        "interview_preparation": ("generate_interview_advice",),
        "career_package": (
            "generate_tailored_resume_content",
            "generate_interview_advice",
        ),
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
        requires_confirmation=any(step.risk == "user_input" for step in steps),
    )

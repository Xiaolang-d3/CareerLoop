from __future__ import annotations

import json
import re
from dataclasses import dataclass

from pydantic import ValidationError

from ..domain import AgentPlan, AgentPlanStep, ModelResponse
from ..tooling import TOOL_SPECS, ToolSpec


# Compatibility name for callers while route policy migrates to capabilities.
TOOL_POLICIES: dict[str, ToolSpec] = TOOL_SPECS


# Always visible to the model, never part of a lane plan, and never blocked as
# tool_not_planned. Must not be added to tools_for_kind / allowed_tools.
INTERRUPT_TOOLS = frozenset({"ask_user"})


@dataclass(frozen=True)
class TaskRoute:
    kind: str
    needs_plan: bool
    allowed_tools: tuple[str, ...]
    required_tools: tuple[str, ...] = ()


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
    "skill_growth": "能力成长分析",
    "job_evaluation": "岗位决策与评估",
}


WEB_SEARCH_MARKER = "[系统可信开关：本轮允许联网搜索]"
JOB_SCREENSHOT_MARKER = "[系统确认：本轮请求分析岗位截图]"
ROUTING_MARKERS = (WEB_SEARCH_MARKER, JOB_SCREENSHOT_MARKER)
SIMPLE_CONVERSATION_MESSAGES = frozenset(
    {
        "hi",
        "hello",
        "hey",
        "你好",
        "您好",
        "在吗",
        "谢谢",
        "感谢",
        "测试",
        "test",
    }
)


@dataclass(frozen=True)
class IntentFlags:
    text: str
    mentions_jd: bool
    asks_analysis: bool
    asks_evidence: bool
    asks_profile_analysis: bool
    asks_project_story: bool
    asks_tailored_resume: bool
    asks_interview: bool
    asks_explicit_web_search: bool
    asks_company_research: bool
    asks_profile_onboarding: bool
    asks_profile_enrichment: bool
    asks_strategy: bool
    asks_debrief: bool
    asks_skill_growth: bool
    asks_job_evaluation: bool


def strip_routing_markers(content: str) -> str:
    """Remove trusted routing switches so keyword intent cannot read them as user text."""
    text = content
    for marker in ROUTING_MARKERS:
        text = text.replace(marker, " ")
    return " ".join(text.split())


def _intent_flags(content: str) -> IntentFlags:
    text = " ".join(content.lower().split())
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
    return IntentFlags(
        text=text,
        mentions_jd=any(word in text for word in ("岗位", "职位", "jd", "职位描述", "岗位要求")),
        asks_analysis=any(
            word in text
            for word in (
                "分析", "匹配", "适合", "评估", "差距", "缺口", "欠缺",
                "改进简历", "面试准备", "技能要求",
            )
        ),
        asks_evidence=any(
            word in text
            for word in ("简历证据", "经历证据", "项目证据", "证明我", "真实经历", "简历里找")
        ),
        asks_profile_analysis=any(
            phrase in text
            for phrase in (
                "我的优势", "我的短板", "我的弱点", "我的竞争力", "我的能力",
                "我的技能", "我的经历", "我的项目", "我的简历", "我的背景",
                "我擅长什么", "我适合什么", "我适合做什么", "职业方向",
                "求职方向", "简历诊断", "评估简历", "分析简历", "优化方向",
                "核心优势", "能力画像", "个人画像",
            )
        ),
        asks_project_story=any(
            phrase in text
            for phrase in (
                "项目亮点", "梳理项目", "项目梳理", "项目复盘", "项目表达",
                "讲项目", "项目故事", "项目经历", "项目经验",
            )
        ),
        asks_tailored_resume=any(
            word in text
            for word in (
                "定制简历", "定制一份简历", "生成简历", "简历内容", "改写简历",
                "优化简历", "高匹配简历", "匹配的简历",
            )
        ),
        asks_interview=any(
            word in text
            for word in (
                "面试准备", "准备面试", "面试建议", "面试问题", "面试题",
                "自我介绍", "反向提问", "star",
            )
        ),
        asks_explicit_web_search=asks_explicit_web_search,
        asks_company_research=asks_company_research,
        asks_profile_onboarding=any(
            phrase in text
            for phrase in (
                "初始化画像", "建立画像", "创建画像", "画像访谈", "开始了解我", "了解我",
                "完善画像", "我的画像", "保存我的信息", "介绍一下我自己", "自我介绍一下",
            )
        ),
        asks_profile_enrichment=any(
            phrase in text
            for phrase in (
                "补充画像", "补充经历", "记住我的", "加入画像", "记录我的能力",
                "更新画像", "补充我的", "记录我的",
            )
        ),
        asks_strategy=any(
            phrase in text for phrase in ("职业策略", "求职策略", "目标岗位方向", "薪资目标", "工作方式偏好")
        ),
        asks_debrief=any(
            phrase in text for phrase in ("面试复盘", "复盘面试", "刚面试完", "面试官问了")
        ),
        asks_skill_growth=any(
            phrase in text for phrase in ("能力成长", "学习计划", "重复缺口", "技能成长")
        ),
        asks_job_evaluation=any(
            phrase in text for phrase in (
                "完整评估", "岗位决策报告", "a-g", "比较岗位", "岗位比较", "审核评估",
            )
        ),
    )


def detect_kind(content: str) -> str:
    """Keyword intent only. Never selects tools; trusted markers are stripped first."""
    flags = _intent_flags(strip_routing_markers(content))
    if flags.asks_job_evaluation:
        return "job_evaluation"
    if flags.asks_debrief:
        return "interview_debrief"
    if flags.asks_profile_onboarding:
        return "profile_onboarding"
    if flags.asks_profile_enrichment:
        return "profile_enrichment"
    if flags.asks_strategy:
        return "career_strategy"
    if flags.asks_skill_growth:
        return "skill_growth"
    if flags.asks_company_research and flags.mentions_jd and flags.asks_analysis:
        return "job_due_diligence"
    if flags.asks_company_research:
        return "company_research"
    if flags.asks_explicit_web_search:
        return "web_search"
    if flags.asks_tailored_resume and flags.asks_interview:
        return "career_package"
    if flags.asks_tailored_resume:
        return "tailored_resume"
    if flags.asks_interview:
        return "interview_preparation"
    if flags.asks_project_story:
        return "project_story"
    if flags.mentions_jd and flags.asks_analysis:
        return "jd_analysis"
    if flags.asks_evidence:
        return "resume_evidence"
    if flags.asks_profile_analysis:
        return "profile_analysis"
    return "conversation"


# Lanes that used to win before the trusted web-search switch. Keep that order.
_WEB_SEARCH_DOES_NOT_OVERRIDE = {
    "job_evaluation",
    "interview_debrief",
    "profile_onboarding",
    "profile_enrichment",
    "career_strategy",
    "skill_growth",
}


def apply_hard_gates(content: str, keyword_kind: str) -> str:
    """Force a lane from trusted switches. These never go to the classifier."""
    resolved = keyword_kind if keyword_kind in ROUTE_LABELS else "conversation"
    flags = _intent_flags(strip_routing_markers(content))
    if WEB_SEARCH_MARKER in content and resolved not in _WEB_SEARCH_DOES_NOT_OVERRIDE:
        if flags.asks_company_research:
            return "company_research"
        return "web_search"
    if JOB_SCREENSHOT_MARKER in content:
        return "jd_analysis"
    return resolved


def tools_for_kind(
    kind: str,
    content: str,
    available_tools: set[str],
    tool_specs: dict[str, ToolSpec] | None = None,
) -> tuple[str, ...]:
    """Compose the smallest registered tool surface from capability metadata."""
    flags = _intent_flags(strip_routing_markers(content))
    text = flags.text
    tools: list[str] = []
    specs = tool_specs or TOOL_SPECS

    def add_capability(capability: str, *, all_matches: bool = False) -> None:
        matches = sorted(
            (
                spec
                for name, spec in specs.items()
                if name in available_tools and capability in spec.capabilities
            ),
            key=lambda spec: (spec.priority, spec.name),
        )
        for spec in matches if all_matches else matches[:1]:
            if spec.name not in tools:
                tools.append(spec.name)

    if kind == "job_evaluation":
        if any(phrase in text for phrase in ("比较岗位", "岗位比较")):
            add_capability("report.compare")
            add_capability("report.read")
        elif any(phrase in text for phrase in ("审核评估", "确认风险", "驳回风险")):
            add_capability("report.review")
            add_capability("report.read")
        else:
            add_capability("report.generate")
            add_capability("report.read")
    elif kind == "interview_debrief":
        add_capability("candidate.debrief")
        add_capability("candidate.context")
    elif kind == "profile_onboarding":
        add_capability("dialog.start")
        add_capability("dialog.record")
        add_capability("dialog.pause")
        add_capability("candidate.context")
        add_capability("candidate.memory")
    elif kind == "profile_enrichment":
        add_capability("dialog.record")
        add_capability("dialog.start")
        add_capability("dialog.pause")
        add_capability("candidate.context")
        add_capability("candidate.memory")
    elif kind == "career_strategy":
        add_capability("candidate.context")
        add_capability("candidate.memory")
    elif kind == "skill_growth":
        add_capability("candidate.context")
        add_capability("memory.search")
    elif kind == "company_research":
        add_capability("company.research")
    elif kind == "web_search":
        add_capability("web.search.generic")
    elif kind == "job_due_diligence":
        add_capability("candidate.match")
        add_capability("candidate.evidence")
        add_capability("company.research")
    elif kind == "career_package":
        add_capability("candidate.match")
        add_capability("candidate.evidence")
        add_capability("candidate.material")
        add_capability("candidate.advice")
    elif kind == "tailored_resume":
        add_capability("candidate.match")
        add_capability("candidate.evidence")
        add_capability("candidate.material")
    elif kind == "interview_preparation":
        add_capability("candidate.match")
        add_capability("candidate.evidence")
        add_capability("candidate.advice")
    elif kind == "project_story":
        add_capability("candidate.context")
        add_capability("candidate.evidence")
    elif kind == "jd_analysis":
        add_capability("candidate.match")
        add_capability("candidate.evidence")
    elif kind == "resume_evidence":
        add_capability("candidate.evidence")
    elif kind == "profile_analysis":
        add_capability("candidate.evidence")
    return tuple(tools)


def build_task_route(
    kind: str,
    content: str,
    available_tools: set[str],
    *,
    profile_interview_active: bool = False,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> TaskRoute:
    """Assemble a route from a lane name. Interview session is a hard rule, not a classifier input."""
    resolved = kind if kind in ROUTE_LABELS else "conversation"
    specs = tool_specs or TOOL_SPECS
    tools = list(tools_for_kind(resolved, content, available_tools, specs))
    if profile_interview_active:
        # A running interview makes every reply a possible answer. Keep the
        # current lane unless this turn was open conversation, and only admit
        # the interview tools — do not expand the full enrichment surface.
        if resolved == "conversation":
            resolved = "profile_enrichment"
        interview_capabilities = ("dialog.record", "dialog.pause", "dialog.start")
        for capability in interview_capabilities:
            match = min(
                (
                    spec
                    for name, spec in specs.items()
                    if name in available_tools and capability in spec.capabilities
                ),
                key=lambda spec: (spec.priority, spec.name),
                default=None,
            )
            if match is not None and match.name not in tools:
                tools.append(match.name)
    route = TaskRoute(kind=resolved, needs_plan=bool(tools), allowed_tools=tuple(tools))
    return TaskRoute(
        kind=route.kind,
        needs_plan=route.needs_plan,
        allowed_tools=route.allowed_tools,
        required_tools=tuple(required_tools_for_route(route, specs)),
    )


def route_task(
    content: str,
    available_tools: set[str],
    *,
    profile_interview_active: bool = False,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> TaskRoute:
    """Keyword fast path plus hard gates. Does not call the model."""
    kind = apply_hard_gates(content, detect_kind(content))
    return build_task_route(
        kind,
        content,
        available_tools,
        profile_interview_active=profile_interview_active,
        tool_specs=tool_specs,
    )


def should_classify_kind(route: TaskRoute, content: str) -> bool:
    """Only classify when keywords and hard gates left the turn as open conversation."""
    if route.kind != "conversation":
        return False
    normalized = strip_routing_markers(content).strip().lower().rstrip("!！?？。,. ")
    if not normalized or normalized in SIMPLE_CONVERSATION_MESSAGES:
        return False
    return True


def classifier_prompt(content: str) -> str:
    """Ask the model for a lane name only. Tool names are intentionally absent."""
    lanes = "\n".join(f"- {kind}: {label}" for kind, label in ROUTE_LABELS.items())
    return f"""判断下面这条用户消息属于哪条求职任务车道。
只返回 JSON：{{"kind":"车道名"}}
允许的车道：
{lanes}
规则：只选一个车道；不确定则 kind 为 conversation；不要输出工具名；不要解释。
用户消息：
{strip_routing_markers(content)}"""


def parse_classified_kind(response: ModelResponse) -> str | None:
    """Accept only a ROUTE_LABELS kind. Tool names and unknown keys are ignored."""
    if response.tool_calls or not response.content.strip():
        return None
    raw = response.content.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    kind = str(payload.get("kind") or "").strip()
    if kind in TOOL_POLICIES or kind not in ROUTE_LABELS:
        return None
    return kind


def refine_route_from_classifier(
    route: TaskRoute,
    content: str,
    available_tools: set[str],
    response: ModelResponse,
    *,
    profile_interview_active: bool = False,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> TaskRoute:
    """Apply a kind-only classifier result. Invalid output leaves the keyword route."""
    if not should_classify_kind(route, content):
        return route
    classified = parse_classified_kind(response)
    if classified is None:
        return route
    return build_task_route(
        classified,
        content,
        available_tools,
        profile_interview_active=profile_interview_active,
        tool_specs=tool_specs,
    )


def route_summary(route: TaskRoute) -> str:
    label = ROUTE_LABELS.get(route.kind, route.kind)
    if route.allowed_tools:
        return f"已识别为{label}，需要先规划并限制可用工具"
    return f"已识别为{label}，无需调用工具"


def tool_progress_message(tool_name: str, arguments: dict | None = None) -> str:
    """User-visible line for a running tool, using the model's actual arguments."""
    args = arguments or {}
    company = str(args.get("company_name") or "").strip()
    query = str(args.get("query") or "").strip()
    url = str(args.get("url") or args.get("official_website") or "").strip()
    if tool_name == "research_company" and company:
        return f"正在检索：{company}"
    question = str(args.get("question") or "").strip()
    if tool_name == "ask_user":
        return f"需要你确认：{question}" if question else "需要你确认后才能继续"
    if query:
        return f"正在检索：{query}"
    if url:
        host = re.sub(r"^https?://", "", url, flags=re.IGNORECASE).split("/")[0]
        host = host.removeprefix("www.")
        if host:
            return f"正在阅读 {host}"
    policy = TOOL_POLICIES.get(tool_name)
    if policy:
        return f"正在执行：{policy.title}"
    return "正在执行"


def visible_tools_prompt(
    tool_names: list[str],
    tool_specs: dict[str, ToolSpec] | None = None,
) -> str:
    """Tell the model the exact tool surface for this turn. Names only come from the runtime."""
    if not tool_names:
        return "本轮没有可调用的工具。直接说明当前能力缺失，不要点名或调用未提供的工具。"
    specs = tool_specs or TOOL_SPECS
    lines = []
    for name in tool_names:
        policy = specs.get(name)
        title = policy.title if policy else name
        lines.append(f"- {name}: {title}")
    return (
        "本轮实际可用工具：\n"
        + "\n".join(lines)
        + "\n只允许调用以上工具。缺少对应能力时直接说明，不要点名未提供的工具。"
    )


# Each lane lists the capabilities that must produce a successful event before
# the run can finish. The concrete tool is resolved from the current tool surface.
REQUIRED_CAPABILITIES_BY_ROUTE: dict[str, tuple[str, ...]] = {
    "company_research": ("company.research",),
    "web_search": ("web.search.generic",),
    "job_due_diligence": ("candidate.match", "company.research"),
    "profile_analysis": ("candidate.evidence",),
    "project_story": ("candidate.context", "candidate.evidence"),
    "tailored_resume": ("candidate.material",),
    "interview_preparation": ("candidate.advice",),
    "career_package": ("candidate.material",),
    "interview_debrief": ("candidate.debrief",),
    "profile_onboarding": ("dialog.start",),
    "profile_enrichment": ("dialog.record",),
}


def required_tools_for_route(
    route: TaskRoute,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> list[str]:
    """Resolve completion obligations to concrete tools on this route."""
    if route.required_tools:
        return list(route.required_tools)
    specs = tool_specs or TOOL_SPECS
    allowed = set(route.allowed_tools)
    chosen: list[str] = []
    for capability in REQUIRED_CAPABILITIES_BY_ROUTE.get(route.kind, ()):
        match = min(
            (
                spec
                for name, spec in specs.items()
                if name in allowed and capability in spec.capabilities
            ),
            key=lambda spec: (spec.priority, spec.name),
            default=None,
        )
        if match is not None and match.name not in chosen:
            chosen.append(match.name)
    return chosen


def fallback_plan(
    goal: str,
    route: TaskRoute,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> AgentPlan:
    specs = tool_specs or TOOL_SPECS
    steps = []
    for index, tool_name in enumerate(route.allowed_tools, start=1):
        policy = specs[tool_name]
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


def replan_prompt(
    goal: str,
    route: TaskRoute,
    failed_tool: str,
    error_message: str,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> str:
    """Ask for one same-lane replacement plan after a tool failure."""
    specs = tool_specs or TOOL_SPECS
    tool_lines = "\n".join(
        f"- {name}: {specs[name].title}，风险={specs[name].risk}"
        for name in route.allowed_tools
    )
    return f"""当前求职任务的一个工具失败了，请在同一车道重新生成 JSON 计划。
任务：{goal}
路由：{route.kind}
失败工具：{failed_tool}
失败原因：{error_message[:300]}
只允许使用以下工具：
{tool_lines}

返回且只返回 JSON：
{{"goal":"一句话目标","steps":[{{"tool_name":"工具名","title":"用户可理解的步骤"}}]}}
规则：不得换车道；不得添加未列出的工具；不得把未检索到的经历写成事实；
优先选择尚未失败的工具；只有没有替代工具时才重试失败工具；不要输出思维过程。"""


def planner_prompt(
    goal: str,
    route: TaskRoute,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> str:
    specs = tool_specs or TOOL_SPECS
    tool_lines = "\n".join(
        f"- {name}: {specs[name].title}，风险={specs[name].risk}"
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


def parse_plan(
    response: ModelResponse,
    goal: str,
    route: TaskRoute,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> AgentPlan:
    specs = tool_specs or TOOL_SPECS
    if response.tool_calls or not response.content.strip():
        return fallback_plan(goal, route, specs)
    raw = response.content.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return fallback_plan(goal, route, specs)

    allowed = set(route.allowed_tools)
    steps: list[AgentPlanStep] = []
    for item in payload.get("steps", []):
        tool_name = str(item.get("tool_name", ""))
        if tool_name not in allowed or tool_name in {step.tool_name for step in steps}:
            continue
        policy = specs[tool_name]
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
    for tool_name in required_tools_for_route(route):
        if tool_name not in allowed or tool_name in {step.tool_name for step in steps}:
            continue
        policy = specs[tool_name]
        steps.append(
            AgentPlanStep(
                id=f"step-{len(steps) + 1}",
                title=policy.title,
                tool_name=tool_name,
                risk=policy.risk,
            )
        )
    if not steps:
        return fallback_plan(goal, route, specs)
    return AgentPlan(
        goal=str(payload.get("goal") or goal).strip()[:300],
        route=route.kind,
        steps=steps,
        requires_confirmation=any(step.risk == "confirmed_local_write" for step in steps),
    )

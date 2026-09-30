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
    "conversation": "日常问答",
    "library_search": "知识库问答",
    "library_update": "补充知识",
    "content_creation": "内容创作",
    "web_search": "联网搜索",
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


def strip_routing_markers(content: str) -> str:
    """Remove trusted routing switches so keyword intent cannot read them as user text."""
    text = content
    for marker in ROUTING_MARKERS:
        text = text.replace(marker, " ")
    return " ".join(text.split())


def detect_kind(content: str) -> str:
    text = strip_routing_markers(content).lower()
    if any(word in text for word in ("记住", "加入知识库", "记录知识", "保存这条知识")):
        return "library_update"
    if any(word in text for word in ("联网", "网上查", "搜索一下", "查一下最新")):
        return "web_search"
    if any(word in text for word in ("写文章", "改写", "总结", "大纲", "创作", "写一篇")):
        return "content_creation"
    if any(word in text for word in ("知识库", "我的资料", "我的笔记", "已保存", "这份材料", "查找资料")):
        return "library_search"
    return "conversation"


def apply_hard_gates(content: str, keyword_kind: str) -> str:
    if WEB_SEARCH_MARKER in content:
        return "web_search"
    return keyword_kind if keyword_kind in ROUTE_LABELS else "conversation"


def tools_for_kind(
    kind: str,
    content: str,
    available_tools: set[str],
    tool_specs: dict[str, ToolSpec] | None = None,
) -> tuple[str, ...]:
    capabilities = {
        "library_search": ("library.read", "library.search"),
        "content_creation": ("library.read", "library.search"),
        "library_update": ("library.read", "library.propose"),
        "web_search": ("web.search.generic",),
    }.get(kind, ())
    specs = tool_specs or TOOL_SPECS
    selected = []
    for capability in capabilities:
        matches = sorted(
            (spec for name, spec in specs.items()
             if name in available_tools and capability in spec.capabilities),
            key=lambda spec: (spec.priority, spec.name),
        )
        if matches and matches[0].name not in selected:
            selected.append(matches[0].name)
    return tuple(selected)


def build_task_route(
    kind: str,
    content: str,
    available_tools: set[str],
    *,
    profile_interview_active: bool = False,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> TaskRoute:
    # Historical interview sessions no longer change the tool surface.
    resolved = kind if kind in ROUTE_LABELS else "conversation"
    specs = tool_specs or TOOL_SPECS
    allowed = tools_for_kind(resolved, content, available_tools, specs)
    route = TaskRoute(kind=resolved, needs_plan=bool(allowed), allowed_tools=allowed)
    return TaskRoute(
        kind=resolved, needs_plan=bool(allowed), allowed_tools=allowed,
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
    return f"""判断下面这条用户消息属于哪条工作任务车道。
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
    "web_search": ("web.search.generic",),
    "library_search": ("library.read",),
    "content_creation": ("library.read",),
    "library_update": ("library.propose",),
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
        goal=goal.strip()[:300] or "完成当前工作任务",
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
    return f"""当前工作任务的一个工具失败了，请在同一车道重新生成 JSON 计划。
任务：{goal}
路由：{route.kind}
失败工具：{failed_tool}
失败原因：{error_message[:300]}
只允许使用以下工具：
{tool_lines}

返回且只返回 JSON：
{{"goal":"一句话目标","steps":[{{"tool_name":"工具名","title":"用户可理解的步骤"}}]}}
规则：不得换车道；不得添加未列出的工具；不得把未检索到的信息写成事实；
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
    return f"""为下面的工作任务生成简短、可执行、可审计的 JSON 计划。
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

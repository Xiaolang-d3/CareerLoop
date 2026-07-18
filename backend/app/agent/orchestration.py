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
    "get_candidate_context": ToolPolicy("read_only", "读取人物画像"),
    "get_job_detail": ToolPolicy("read_only", "读取岗位详情"),
    "search_local_knowledge": ToolPolicy("read_only", "检索本地证据"),
    "rank_jobs": ToolPolicy("analysis", "比较岗位优先级"),
    "analyze_job": ToolPolicy("analysis", "分析岗位匹配度"),
    "analyze_resume_gap": ToolPolicy("analysis", "分析简历差距"),
    "update_job_status": ToolPolicy("local_write", "更新岗位状态"),
    "save_greeting_draft": ToolPolicy("local_write", "保存沟通草稿"),
    "queue_application": ToolPolicy("local_write", "加入待投递队列"),
    "update_application_status": ToolPolicy("local_write", "更新求职进展"),
    "request_manual_job_import": ToolPolicy("user_input", "等待用户导入岗位"),
}


@dataclass(frozen=True)
class TaskRoute:
    kind: str
    needs_plan: bool
    allowed_tools: tuple[str, ...]


ROUTE_LABELS = {
    "conversation": "普通求职咨询",
    "job_import": "岗位导入任务",
    "job_analysis": "岗位匹配分析",
    "profile_analysis": "候选人画像分析",
    "job_context": "岗位信息查询",
    "local_action": "本地记录操作",
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

    asks_for_jobs = any(word in text for word in ("找岗位", "找工作", "搜索岗位", "搜岗位", "推荐岗位", "采集岗位"))
    mentions_job = any(word in text for word in ("岗位", "职位", "jd", "公司", "薪资"))
    mentions_profile = any(word in text for word in ("简历", "画像", "经历", "技能", "竞争力"))
    asks_gap = any(word in text for word in ("差距", "缺口", "欠缺", "改进简历"))
    asks_analysis = any(word in text for word in ("分析", "匹配", "适合", "评估", "比较", "优先级"))

    if asks_for_jobs:
        kind = "job_import"
        add("request_manual_job_import")
    elif mentions_job and (asks_analysis or asks_gap):
        kind = "job_analysis"
        add("get_candidate_context", "get_job_detail")
        add("analyze_resume_gap" if asks_gap else "analyze_job")
        add("search_local_knowledge")
    elif mentions_profile and asks_analysis:
        kind = "profile_analysis"
        add("get_candidate_context", "search_local_knowledge")
        if mentions_job and asks_gap:
            add("get_job_detail", "analyze_resume_gap")
    elif mentions_job:
        kind = "job_context"
        add("get_job_detail")

    # Mutating tools are exposed only for explicit user intent. This is enforced
    # in code in addition to the model instructions.
    if any(word in text for word in ("收藏", "标记候选", "跳过这个岗位", "取消收藏")):
        kind = "local_action"
        add("get_job_detail", "update_job_status")
    if "保存" in text and any(word in text for word in ("话术", "沟通草稿", "招呼语")):
        kind = "local_action"
        add("get_candidate_context", "get_job_detail", "save_greeting_draft")
    if any(word in text for word in ("加入待投", "加入队列", "待投递队列")):
        kind = "local_action"
        add("get_job_detail", "queue_application")
    if any(word in text for word in ("更新投递状态", "记录已投递", "记录面试", "记录被拒", "记录已联系")):
        kind = "local_action"
        add("update_application_status")

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
    if not steps:
        return fallback_plan(goal, route)
    return AgentPlan(
        goal=str(payload.get("goal") or goal).strip()[:300],
        route=route.kind,
        steps=steps,
        requires_confirmation=any(step.risk == "user_input" for step in steps),
    )

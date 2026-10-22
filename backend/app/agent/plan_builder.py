from __future__ import annotations

from typing import Literal

from ..domain import AgentPlan, AgentPlanStep
from ..tooling import TOOL_SPECS, ToolSpec
from .capability_resolver import TaskRoute, capability_group


PlanMode = Literal["none", "static", "llm"]


def plan_mode(route: TaskRoute, tool_specs: dict[str, ToolSpec] | None = None) -> PlanMode:
    """Decide how the run obtains its plan without spending a planner call."""
    specs = tool_specs or TOOL_SPECS
    if not route.allowed_tools:
        return "none"
    groups = {capability_group(specs[name]) for name in route.allowed_tools if name in specs}
    return "llm" if route.needs_plan or len(groups) >= 2 else "static"


def fallback_plan(
    goal: str,
    route: TaskRoute,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> AgentPlan:
    """Deterministic plan over the authorized surface, used for simple tasks."""
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

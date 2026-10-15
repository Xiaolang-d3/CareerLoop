from __future__ import annotations

from dataclasses import dataclass

from ..domain import AgentPlan, AgentPlanStep
from ..tooling import TOOL_SPECS, ToolSpec
from .capability_resolver import TaskRoute, capability_group


MAX_PLAN_STEPS = 6


@dataclass(frozen=True)
class PlanValidationResult:
    valid: bool
    reason: str | None = None
    normalized_plan: AgentPlan | None = None


def _group_for(tool_name: str, specs: dict[str, ToolSpec]) -> str:
    spec = specs.get(tool_name)
    return capability_group(spec) if spec is not None else tool_name


def validate_plan(
    route: TaskRoute,
    plan: AgentPlan,
    *,
    registered_specs: dict[str, ToolSpec] | None = None,
    max_steps: int = MAX_PLAN_STEPS,
) -> PlanValidationResult:
    """Enforce required ⊆ planned ⊆ allowed ⊆ registered with trusted metadata."""
    specs = registered_specs or TOOL_SPECS
    allowed = set(route.allowed_tools)
    if not allowed.issubset(specs):
        return PlanValidationResult(valid=False, reason="路由包含未注册工具")
    if plan.route != route.kind:
        return PlanValidationResult(valid=False, reason="计划车道与路由不一致")

    steps: list[AgentPlanStep] = []
    planned_tools: set[str] = set()
    for raw_step in plan.steps:
        tool_name = raw_step.tool_name
        if tool_name not in allowed:
            return PlanValidationResult(
                valid=False, reason=f"计划包含未授权工具：{tool_name}"
            )
        if tool_name in planned_tools:
            # MVP supports one logical plan step per tool; drop duplicates.
            continue
        spec = specs[tool_name]
        planned_tools.add(tool_name)
        steps.append(
            AgentPlanStep(
                id=f"step-{len(steps) + 1}",
                title=(raw_step.title or spec.title)[:100],
                tool_name=tool_name,
                risk=spec.risk,
                status=raw_step.status,
            )
        )

    if len(steps) > max_steps:
        return PlanValidationResult(valid=False, reason="计划步骤过多")

    planned_groups = {_group_for(tool_name, specs) for tool_name in planned_tools}
    for required_tool in route.required_tools:
        if required_tool not in allowed:
            return PlanValidationResult(
                valid=False, reason=f"必需工具未获授权：{required_tool}"
            )
        if _group_for(required_tool, specs) in planned_groups:
            # A sibling tool in the same capability group satisfies the
            # obligation; freeze_route_requirements pins the planned sibling.
            continue
        spec = specs[required_tool]
        planned_tools.add(required_tool)
        planned_groups.add(_group_for(required_tool, specs))
        steps.append(
            AgentPlanStep(
                id=f"step-{len(steps) + 1}",
                title=spec.title,
                tool_name=required_tool,
                risk=spec.risk,
            )
        )

    if len(steps) > max_steps:
        return PlanValidationResult(valid=False, reason="计划步骤过多")

    if not steps and allowed:
        for tool_name in route.allowed_tools:
            spec = specs[tool_name]
            steps.append(
                AgentPlanStep(
                    id=f"step-{len(steps) + 1}",
                    title=spec.title,
                    tool_name=tool_name,
                    risk=spec.risk,
                )
            )

    normalized = AgentPlan(
        goal=(plan.goal.strip()[:300] or "完成当前工作任务"),
        route=route.kind,
        steps=steps,
        requires_confirmation=any(step.risk == "confirmed_local_write" for step in steps),
    )
    return PlanValidationResult(valid=True, normalized_plan=normalized)


def freeze_route_requirements(
    route: TaskRoute,
    plan: AgentPlan | None,
    registered_specs: dict[str, ToolSpec] | None = None,
) -> TaskRoute:
    """Pin completion obligations to the read/propose path actually planned.

    The initial route carries canonical tools per capability. When the plan
    chose a sibling tool from the same capability group (for example
    ``search_library`` instead of ``get_library_context``), the obligation is
    rewritten to that sibling so completion matches the plan instead of
    demanding both read paths succeed.
    """
    specs = registered_specs or TOOL_SPECS
    if plan is None or not route.required_tools:
        return route
    planned = [step.tool_name for step in plan.steps]
    frozen: list[str] = []
    for required_tool in route.required_tools:
        group = _group_for(required_tool, specs)
        replacement = next(
            (
                name
                for name in planned
                if name != required_tool and _group_for(name, specs) == group
            ),
            required_tool,
        )
        if replacement not in frozen:
            frozen.append(replacement)
    return TaskRoute(
        kind=route.kind,
        needs_plan=route.needs_plan,
        allowed_tools=route.allowed_tools,
        required_tools=tuple(frozen),
    )

from __future__ import annotations

from app.agent.capability_resolver import TaskRoute
from app.agent.orchestration import parse_plan
from app.agent.plan_builder import fallback_plan, plan_mode
from app.agent.plan_validator import MAX_PLAN_STEPS, freeze_route_requirements, validate_plan
from app.domain import AgentPlan, AgentPlanStep, ModelResponse
from app.tooling import TOOL_SPECS


SURFACE = dict(TOOL_SPECS)


def _plan(*tool_names: str, route: str = "library_search") -> AgentPlan:
    return AgentPlan(
        goal="测试目标",
        route=route,
        steps=[
            AgentPlanStep(id=f"step-{index}", title=name, tool_name=name, risk="read_only")
            for index, name in enumerate(tool_names, start=1)
        ],
    )


def test_plan_mode_none_for_empty_surface_static_for_single_group_llm_for_mixed() -> None:
    assert plan_mode(TaskRoute("conversation", False, ()), SURFACE) == "none"
    library = TaskRoute("library_search", False, ("get_library_context", "search_library"))
    assert plan_mode(library, SURFACE) == "static"
    mixed = TaskRoute(
        "library_search", True, ("get_library_context", "search_public_web")
    )
    assert plan_mode(mixed, SURFACE) == "llm"


def test_static_fallback_plan_covers_authorized_surface() -> None:
    route = TaskRoute("library_search", False, ("get_library_context", "search_library"))
    plan = fallback_plan("查资料", route, SURFACE)
    assert [step.tool_name for step in plan.steps] == ["get_library_context", "search_library"]
    assert all(step.risk == "read_only" for step in plan.steps)


def test_validate_rejects_plan_outside_allowed_surface() -> None:
    route = TaskRoute("library_search", False, ("get_library_context",))
    result = validate_plan(route, _plan("search_public_web"), registered_specs=SURFACE)
    assert not result.valid
    assert "未授权工具" in (result.reason or "")


def test_validate_rejects_lane_mismatch_and_unknown_registration() -> None:
    route = TaskRoute("library_search", False, ("get_library_context",))
    mismatched = validate_plan(route, _plan("get_library_context", route="web_search"), registered_specs=SURFACE)
    assert not mismatched.valid
    unregistered = validate_plan(
        TaskRoute("library_search", False, ("invented_tool",)),
        _plan("invented_tool"),
        registered_specs=SURFACE,
    )
    assert not unregistered.valid


def test_validate_repairs_missing_required_tool_and_dedupes() -> None:
    route = TaskRoute(
        "library_search", False, ("get_library_context", "search_library"),
        ("get_library_context",),
    )
    duplicate = AgentPlan(
        goal="目标",
        route="library_search",
        steps=[
            AgentPlanStep(id="step-1", title="读取", tool_name="search_library", risk="read_only"),
            AgentPlanStep(id="step-2", title="重复", tool_name="search_library", risk="read_only"),
        ],
    )
    result = validate_plan(route, duplicate, registered_specs=SURFACE)
    assert result.valid
    tools = [step.tool_name for step in result.normalized_plan.steps]
    assert tools == ["search_library"]
    assert all(step.risk == "read_only" for step in result.normalized_plan.steps)


def test_validate_adds_required_tool_when_group_not_planned() -> None:
    route = TaskRoute(
        "library_update", True,
        ("get_library_context", "propose_library_knowledge"),
        ("propose_library_knowledge",),
    )
    result = validate_plan(route, _plan("get_library_context", route="library_update"), registered_specs=SURFACE)
    assert result.valid
    tools = [step.tool_name for step in result.normalized_plan.steps]
    assert "propose_library_knowledge" in tools


def test_validate_falls_back_to_full_surface_when_plan_empty() -> None:
    route = TaskRoute("web_search", False, ("search_public_web",), ("search_public_web",))
    result = validate_plan(route, _plan(route="web_search"), registered_specs=SURFACE)
    assert result.valid
    assert [step.tool_name for step in result.normalized_plan.steps] == ["search_public_web"]


def test_validate_rejects_overlong_plan() -> None:
    route = TaskRoute(
        "library_search", True,
        tuple(["get_library_context"] + [f"tool_{index}" for index in range(MAX_PLAN_STEPS + 2)]),
    )
    steps = [
        AgentPlanStep(id=f"step-{index}", title="步骤", tool_name=name, risk="read_only")
        for index, name in enumerate(route.allowed_tools, start=1)
    ]
    result = validate_plan(
        route,
        AgentPlan(goal="目标", route="library_search", steps=steps),
        registered_specs={**SURFACE, **{
            name: SURFACE["get_library_context"].model_copy(update={"name": name})
            for name in route.allowed_tools if name not in SURFACE
        }},
    )
    assert not result.valid


def test_freeze_pins_planned_sibling_for_completion() -> None:
    route = TaskRoute(
        "library_search", False, ("get_library_context", "search_library"),
        ("get_library_context",),
    )
    frozen = freeze_route_requirements(
        route, _plan("search_library"), registered_specs=SURFACE
    )
    assert frozen.required_tools == ("search_library",)


def test_parse_plan_ignores_non_dict_steps_and_clamps_title() -> None:
    route = TaskRoute("web_search", False, ("search_public_web",), ("search_public_web",))
    response = ModelResponse(
        content=(
            '{"goal":"' + "目标" * 400 + '", "steps":['
            '"不是对象",'
            '{"tool_name":"search_public_web","title":"' + "标题" * 200 + '"}'
            "]}"
        )
    )
    plan = parse_plan(response, "查询", route, SURFACE)
    assert [step.tool_name for step in plan.steps] == ["search_public_web"]
    assert len(plan.steps[0].title) <= 100
    assert len(plan.goal) <= 300


def test_parse_plan_recovers_from_malformed_payload() -> None:
    route = TaskRoute("library_search", False, ("get_library_context",))
    plan = parse_plan(ModelResponse(content="不是 JSON"), "目标", route, SURFACE)
    assert [step.tool_name for step in plan.steps] == ["get_library_context"]

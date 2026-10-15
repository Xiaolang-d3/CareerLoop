from __future__ import annotations

from dataclasses import dataclass

from ..domain import AgentPlan, ToolEvent
from ..tooling import TOOL_SPECS, ToolSpec
from .capability_resolver import TaskRoute, capability_group
from .orchestration import required_tools_for_route


@dataclass(frozen=True)
class CompletionValidation:
    """Result of checking whether a run may return a final answer."""

    complete: bool
    missing_tools: tuple[str, ...] = ()

    @property
    def tool_choice(self) -> str:
        return "auto" if self.complete else "required"

    def repair_prompt(self) -> str:
        missing = "、".join(self.missing_tools)
        return (
            "当前任务还没有完成，不能返回最终回答。"
            f"必须先成功调用这些必要工具：{missing}。"
            "请现在调用一个尚未完成的必要工具；不要解释工具限制，"
            "不要向用户声称任务已经完成。"
        )


def _group_for(tool_name: str, specs: dict[str, ToolSpec]) -> str:
    spec = specs.get(tool_name)
    return capability_group(spec) if spec is not None else tool_name


def validate_completion(
    route: TaskRoute,
    events: list[ToolEvent],
    plan: AgentPlan | None = None,
    completed_tools: set[str] | None = None,
    tool_specs: dict[str, ToolSpec] | None = None,
) -> CompletionValidation:
    """Use successful events and persisted plan state as completion evidence.

    A required capability can be satisfied by any tool from the same
    capability group (read or search over the private library), so the runtime
    does not force both read paths to run when the plan only needed one.
    """

    specs = tool_specs or TOOL_SPECS
    required = required_tools_for_route(route, specs)
    completed = {
        event.tool_name
        for event in events
        if event.status == "done"
    }
    completed.update(completed_tools or ())
    if plan is not None:
        completed.update(
            step.tool_name for step in plan.steps if step.status == "done"
        )
    completed_groups = {_group_for(name, specs) for name in completed}
    missing = tuple(
        name
        for name in required
        if name not in completed and _group_for(name, specs) not in completed_groups
    )
    return CompletionValidation(complete=not missing, missing_tools=missing)

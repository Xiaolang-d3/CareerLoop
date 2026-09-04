from __future__ import annotations

from dataclasses import dataclass

from ..domain import AgentPlan, ToolEvent
from .orchestration import TaskRoute, required_tools_for_route


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


def validate_completion(
    route: TaskRoute,
    events: list[ToolEvent],
    plan: AgentPlan | None = None,
    completed_tools: set[str] | None = None,
) -> CompletionValidation:
    """Use successful events and persisted plan state as completion evidence."""

    required = required_tools_for_route(route)
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
    missing = tuple(name for name in required if name not in completed)
    return CompletionValidation(complete=not missing, missing_tools=missing)

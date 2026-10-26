"""Policies for turning clarification replies into visible task progress."""
from __future__ import annotations

import re

from ..domain import AgentMessage


TASK_PROGRESS_GUIDANCE = (
    "对简历、文案、总结等可迭代任务，先用已确认的信息生成或更新可用草稿；"
    "缺失的技术栈、职责、指标标为待补充，不得编造，也不要因此阻止其他部分产出。"
    "只有缺口真正阻止当前动作、无法通过保留空项继续时才调用 ask_user，"
    "并在 blocking_reason 中说明阻塞原因。不要重复询问已回答的信息或已明确的材料提供方式。"
    "用户从调研转为写作时更新交付目标，不要再次输出通用调研报告。"
)


def _question_key(question: str) -> str:
    return re.sub(r"[\s，。！？、：；,.!?:;]+", "", question).casefold()


def clarification_repair_reason(kind: str, arguments: dict, messages: list[AgentMessage]) -> str:
    """Reject redundant creative-task pauses; real blockers remain expressible.

    Approval cards never enter this policy: only the ask_user tool is checked.
    A caller may name a genuine blocker instead of being forced to invent data.
    """
    blocker = arguments.get("blocking_reason", "")
    if kind != "content_creation" or (isinstance(blocker, str) and blocker.strip()):
        return ""
    previous = [message for message in messages if message.payload.get("clarification_question")]
    question = _question_key(str(arguments.get("question") or ""))
    if question and any(_question_key(message.content.split("\n", 1)[0]) == question for message in previous):
        return "这个问题已询问过；请使用用户的最新答复更新已有草稿，确有阻塞时说明具体原因。"
    if len(previous) >= 2 and not any(
        message.role == "assistant" and message.content and not message.payload
        for message in messages
    ):
        return "已连续收集信息但尚无草稿；请先交付可完成部分并标注缺口，确有阻塞时说明具体原因。"
    return ""

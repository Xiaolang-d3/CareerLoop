from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator

from ..domain import ToolDefinition, ToolError, ToolResult
from .base import ToolContext
from .local_data import invalid_arguments


class AskUserOption(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    send: str = Field(default="", max_length=200)

    @field_validator("label", "send")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        return value.strip()


class AskUserArguments(BaseModel):
    question: str = Field(min_length=1, max_length=200)
    options: list[AskUserOption] = Field(min_length=2, max_length=6)
    allow_custom: bool = True

    @field_validator("question")
    @classmethod
    def _strip_question(cls, value: str) -> str:
        return value.strip()


def clarification_payload(
    question: str,
    options: list[AskUserOption] | list[dict[str, str]],
    *,
    allow_custom: bool = True,
) -> dict[str, Any]:
    """Structured pause payload consumed by the chat composer."""
    normalized: list[dict[str, str]] = []
    seen_labels: set[str] = set()
    for index, option in enumerate(options, start=1):
        record = option if isinstance(option, AskUserOption) else AskUserOption.model_validate(option)
        label = record.label
        if label in seen_labels:
            continue
        seen_labels.add(label)
        normalized.append({
            "id": f"opt_{index}",
            "label": label,
            "send": record.send or label,
        })
    return {
        "clarification": {
            "question": question.strip(),
            "options": normalized,
            "allow_custom": allow_custom,
        }
    }


class AskUserTool:
    definition = ToolDefinition(
        name="ask_user",
        description=(
            "当继续执行缺少关键信息，或同一指代有多种合理解读时，向用户列出 2–4 个选项并暂停。"
            "不要猜测公司全称、具体岗位、项目名称或对比对象。"
            "用户点选或输入后，下一轮再继续。不要用它闲聊，也不要确认已经明确的信息。"
        ),
        input_schema=AskUserArguments.model_json_schema(),
    )

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        del context
        try:
            payload = AskUserArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("确认选项不合法", exc)
        data = clarification_payload(
            payload.question,
            payload.options,
            allow_custom=payload.allow_custom,
        )
        options = data["clarification"]["options"]
        if len(options) < 2:
            return invalid_arguments(
                "确认选项不合法",
                ValueError("至少需要两个不重复的选项"),
            )
        message = payload.question
        return ToolResult(
            ok=False,
            status="waiting_approval",
            data=data,
            message=message,
            error=ToolError(
                code="user_clarification_required",
                message=message,
                retryable=True,
            ),
        )

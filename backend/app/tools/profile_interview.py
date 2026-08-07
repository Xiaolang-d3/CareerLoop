from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from ..candidate_core import (
    ensure_profile,
    get_or_start_profile_interview,
    get_profile_interview_session,
    record_profile_interview_answer,
    set_profile_interview_status,
)
from ..domain import ToolDefinition, ToolError, ToolResult
from .base import ToolContext
from .local_data import tool_error_boundary


def _missing_conversation(message: str) -> ToolResult:
    return ToolResult(
        ok=False,
        status="failed",
        message=message,
        error=ToolError(
            code="conversation_required",
            message="画像访谈需要在具体会话中进行。",
        ),
    )


class StartProfileInterviewArguments(BaseModel):
    """No inputs: the session is keyed by the conversation the tool runs in."""


class StartProfileInterviewTool:
    definition = ToolDefinition(
        name="start_profile_interview",
        description=(
            "开始或恢复对话式画像访谈，一次只问一个问题。"
            "当用户想建立、初始化、完善画像，或希望你了解他的背景时使用；"
            "没有画像时会自动创建。"
        ),
        input_schema=StartProfileInterviewArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    @tool_error_boundary("无法开始画像访谈")
    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if context.conversation_id is None:
            return _missing_conversation("无法开始画像访谈")
        ensure_profile(self._db_path)
        session = get_or_start_profile_interview(
            context.conversation_id, db_path=self._db_path
        )
        if session.get("status") == "paused":
            session = set_profile_interview_status(
                context.conversation_id, "active", db_path=self._db_path
            )
        return ToolResult(
            ok=True,
            status="done",
            data={
                "profile_interview": session,
                "next_question": session["question"],
                "answer_handling": "用户的回答先进入待确认区，确认前不影响正式评分或材料",
            },
            message="已进入对话式画像访谈并恢复到上次进度",
        )


class RecordProfileInterviewAnswerArguments(BaseModel):
    answer: str = Field(min_length=1, max_length=10000)


class RecordProfileInterviewAnswerTool:
    definition = ToolDefinition(
        name="record_profile_interview_answer",
        description=(
            "把用户对当前画像访谈问题的回答保存为待确认知识，并推进到下一个问题。"
            "仅在存在进行中的画像访谈、且本轮内容是在回答该问题时使用。"
        ),
        input_schema=RecordProfileInterviewAnswerArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    @tool_error_boundary("无法保存画像访谈回答")
    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if context.conversation_id is None:
            return _missing_conversation("无法保存画像访谈回答")
        payload = RecordProfileInterviewAnswerArguments.model_validate(arguments)
        recorded = record_profile_interview_answer(
            context.conversation_id, payload.answer, db_path=self._db_path
        )
        session = recorded["session"]
        return ToolResult(
            ok=True,
            status="done",
            data={
                "knowledge_proposal": recorded["proposal"],
                "profile_interview": session,
                "next_question": session["question"],
            },
            message="已将本轮回答保存为待确认知识，并推进一个访谈阶段",
        )


class PauseProfileInterviewArguments(BaseModel):
    """No inputs: pauses the interview in the current conversation."""


class PauseProfileInterviewTool:
    definition = ToolDefinition(
        name="pause_profile_interview",
        description="按用户要求暂停当前会话的画像访谈；之后可以恢复到同一个问题。",
        input_schema=PauseProfileInterviewArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    @tool_error_boundary("无法暂停画像访谈")
    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if context.conversation_id is None:
            return _missing_conversation("无法暂停画像访谈")
        existing = get_profile_interview_session(
            context.conversation_id, db_path=self._db_path
        )
        if existing is None:
            return ToolResult(
                ok=False,
                status="failed",
                message="当前会话没有进行中的画像访谈",
                error=ToolError(
                    code="no_active_interview",
                    message="当前会话没有进行中的画像访谈，无需暂停。",
                    retryable=True,
                ),
            )
        session = set_profile_interview_status(
            context.conversation_id, "paused", db_path=self._db_path
        )
        return ToolResult(
            ok=True,
            status="done",
            data={"profile_interview": session},
            message="已按用户指令暂停画像访谈",
        )

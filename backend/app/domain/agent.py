from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class ToolDefinition(BaseModel):
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] = Field(
        default_factory=lambda: {"type": "object", "additionalProperties": True}
    )


class ToolCall(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolError(BaseModel):
    code: str
    message: str
    retryable: bool = False


class ToolResult(BaseModel):
    ok: bool
    status: Literal["done", "failed", "waiting_approval", "blocked"]
    data: dict[str, Any] = Field(default_factory=dict)
    message: str
    error: ToolError | None = None


class AgentMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str = ""
    tool_call_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class ModelUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class ModelRequest(BaseModel):
    messages: list[AgentMessage]
    tools: list[ToolDefinition] = Field(default_factory=list)
    tool_choice: Literal["auto", "required", "none"] = "auto"


class ModelResponse(BaseModel):
    content: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    usage: ModelUsage | None = None
    provider_metadata: dict[str, Any] = Field(default_factory=dict)


class ModelStreamEvent(BaseModel):
    type: Literal["text_delta", "completed"]
    delta: str = ""
    response: ModelResponse | None = None


class ToolEvent(BaseModel):
    round: int
    tool_call_id: str
    tool_name: str
    status: str
    message: str
    data: dict[str, Any] = Field(default_factory=dict)


class AgentPlanStep(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    tool_name: str = Field(min_length=1)
    risk: Literal[
        "read_only", "derived_analysis", "local_pending_write",
        "confirmed_local_write", "external_read",
        # Legacy values stay valid for persisted operation records.
        "analysis", "local_write", "user_input",
    ]
    status: Literal["pending", "running", "done", "failed", "blocked"] = "pending"


class AgentPlan(BaseModel):
    goal: str = Field(min_length=1)
    route: str = Field(min_length=1)
    steps: list[AgentPlanStep] = Field(default_factory=list)
    requires_confirmation: bool = False


class ClarificationOption(BaseModel):
    id: str = ""
    label: str = ""
    send: str = ""


class AgentClarification(BaseModel):
    question: str = ""
    options: list[ClarificationOption] = Field(default_factory=list)
    allow_custom: bool = True


class AgentRunSnapshot(BaseModel):
    route_kind: str
    needs_plan: bool
    allowed_tools: list[str] = Field(default_factory=list)
    required_tools: list[str] = Field(default_factory=list)
    plan: AgentPlan | None = None
    messages: list[AgentMessage] = Field(default_factory=list)
    replan_used: bool = False
    citation_retry_used: bool = False
    rounds_used: int = 0
    clarification: AgentClarification | None = None
    completed_tools: list[str] = Field(default_factory=list)
    completed_tool_calls: list[str] = Field(default_factory=list)
    repeated_tool_calls: dict[str, int] = Field(default_factory=dict)


class AgentRunResult(BaseModel):
    content: str
    provider: str
    platform: str
    rounds: int
    status: Literal["done", "failed", "waiting_user", "cancelled"] = "done"
    error: ToolError | None = None
    events: list[ToolEvent] = Field(default_factory=list)
    plan: AgentPlan | None = None
    snapshot: AgentRunSnapshot | None = None
    stop_reason: str = ""

    @model_validator(mode="after")
    def infer_stop_reason(self) -> "AgentRunResult":
        """Keep every terminal result machine-readable without duplicating status logic."""
        if self.stop_reason:
            return self
        if self.status == "done":
            self.stop_reason = "completed"
        elif self.status == "waiting_user":
            self.stop_reason = "waiting_user"
        elif self.status == "cancelled":
            self.stop_reason = "cancelled"
        elif self.error is not None:
            self.stop_reason = self.error.code
        else:
            self.stop_reason = "failed"
        return self


class AgentStreamEvent(BaseModel):
    type: Literal[
        "run_started",
        "text_reset",
        "text_delta",
        "agent_event",
        "waiting_user",
        "completed",
        "cancelled",
        "error",
    ]
    delta: str = ""
    event: ToolEvent | None = None
    result: AgentRunResult | None = None

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ToolDefinition(BaseModel):
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    input_schema: dict[str, Any]


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


class ModelResponse(BaseModel):
    content: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    usage: ModelUsage | None = None
    provider_metadata: dict[str, Any] = Field(default_factory=dict)


class ToolEvent(BaseModel):
    round: int
    tool_call_id: str
    tool_name: str
    status: str
    message: str
    data: dict[str, Any] = Field(default_factory=dict)


class AgentRunResult(BaseModel):
    content: str
    provider: str
    platform: str
    rounds: int
    events: list[ToolEvent] = Field(default_factory=list)

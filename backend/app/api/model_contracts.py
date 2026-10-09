from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from .schemas import ConversationUpdate


Protocol = Literal["auto", "openai", "responses", "anthropic", "gemini", "ollama"]
ReasoningEffort = Literal["low", "medium", "high"]


class ConnectionCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(default="", max_length=80)
    model_base_url: str = Field(default="", max_length=500)
    model_protocol: Protocol = "auto"
    api_key: str = Field(default="", max_length=500)
    model_name: str = Field(min_length=1, max_length=120)
    data_boundary: str | None = Field(default=None, max_length=120)


class ConnectionUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    name: str | None = Field(default=None, max_length=80)
    model_base_url: str | None = Field(default=None, max_length=500)
    model_protocol: Protocol | None = None
    api_key: str | None = Field(default=None, max_length=500)
    enabled: bool | None = None
    data_boundary: str | None = Field(default=None, max_length=120)


class ProfileCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connection_id: str = Field(min_length=1, max_length=120)
    model_name: str = Field(min_length=1, max_length=120)
    parameters: dict[str, float | int] = Field(default_factory=dict)
    context_limit: int | None = Field(default=None, ge=1)
    reasoning_effort: ReasoningEffort | None = None


class ProfileUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    model_name: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None
    parameters: dict[str, float | int] | None = None
    context_limit: int | None = Field(default=None, ge=1)
    reasoning_effort: ReasoningEffort | None = None


class DefaultProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_id: str = Field(min_length=1, max_length=120)


class ConversationModelUpdate(ConversationUpdate):
    model_profile_id: str | None = Field(default=None, min_length=1, max_length=120)

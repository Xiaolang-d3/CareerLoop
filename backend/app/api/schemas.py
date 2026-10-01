from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

class PrivacyScanIn(BaseModel):
    text: str = Field(default="", max_length=100_000)

class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=500)

class AccountUpdateIn(BaseModel):
    display_name: str = Field(default="", max_length=40)

class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=500)
    new_password: str = Field(min_length=8, max_length=500)


class ConversationIn(BaseModel):
    title: str = Field(default="新对话", max_length=80)

class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    status: Literal["active", "archived"] | None = None

class AgentSettingsIn(BaseModel):
    display_name: str = Field(default="CareerLoop", min_length=1, max_length=40)
    persona_role: str = Field(min_length=1, max_length=300)
    response_style: Literal["concise", "balanced", "detailed"] = "concise"
    custom_instructions: str = Field(default="", max_length=1000)
    library_memory_enabled: bool = True
    conversation_memory_enabled: bool = True
    knowledge_memory_enabled: bool = True
    summary_enabled: bool = True
    context_message_limit: int = Field(default=12, ge=4, le=30)
    model_name: str = Field(default="gpt-5.5", min_length=1, max_length=120)
    model_base_url: str = Field(default="", max_length=500)
    model_protocol: Literal["auto", "openai", "responses", "anthropic", "gemini", "ollama"] = "auto"
    api_key: str = Field(default="", max_length=500)

class ModelDiscoveryIn(BaseModel):
    model_base_url: str = Field(default="", max_length=500)
    model_name: str = Field(default="", max_length=120)
    model_protocol: Literal["auto", "openai", "responses", "anthropic", "gemini", "ollama"] = "auto"
    api_key: str = Field(default="", max_length=500)

class ModelCapabilitiesIn(BaseModel):
    model_name: str = Field(default="", max_length=120)
    model_base_url: str = Field(default="", max_length=500)
    model_protocol: Literal["auto", "openai", "responses", "anthropic", "gemini", "ollama"] = "auto"
    api_key: str = Field(default="", max_length=500)
    probe: bool = False

class LibraryMetadataIn(BaseModel):
    name: str = Field(default="", max_length=100)
    locale: str = Field(default="zh-CN", max_length=20)
    privacy_mode: Literal["redacted", "original"] = "redacted"

class LibrarySourceIn(BaseModel):
    title: str = Field(default="", max_length=255)
    content: str = Field(min_length=1, max_length=200_000)
    source_uri: str = Field(default="", max_length=2_000)
    privacy_mode: Literal["redacted", "original"] = "redacted"

class LibrarySourceUpdateIn(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    content: str | None = Field(default=None, max_length=200_000)
    privacy_mode: Literal["redacted", "original"] | None = None
    enabled: bool | None = None

class LibraryKnowledgeIn(BaseModel):
    category: str = Field(min_length=1, max_length=50)
    statement: str = Field(min_length=1, max_length=5_000)
    canonical_key: str = Field(default="", max_length=200)
    value: dict[str, Any] = Field(default_factory=dict)
    sensitivity: Literal["public", "private", "sensitive"] = "private"
    source_id: int | None = Field(default=None, ge=1)
    excerpt: str = Field(default="", max_length=5_000)
    locator: str = Field(default="", max_length=500)

class LibraryKnowledgeReviewIn(BaseModel):
    action: Literal["confirm", "edit", "reject", "retract"]
    statement: str = Field(default="", max_length=5_000)

class LibraryKnowledgeMergeIn(BaseModel):
    target_fact_id: int = Field(ge=1)

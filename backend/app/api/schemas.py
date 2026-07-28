from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CandidateProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    resume_text: str = Field(default="", max_length=100_000)
    resume_filename: str = Field(default="", max_length=255)
    resume_redacted_text: str = Field(default="", max_length=100_000)
    privacy_mode: Literal["redacted", "original"] = "redacted"
    skills: list[str] = Field(default_factory=list)
    projects: list[dict[str, Any]] = Field(default_factory=list)
    target_roles: list[str] = Field(default_factory=list)
    target_cities: list[str] = Field(default_factory=list)
    salary_min: int | None = Field(default=None, ge=0)
    salary_max: int | None = Field(default=None, ge=0)
    preferred_industries: list[str] = Field(default_factory=list)
    blocked_keywords: list[str] = Field(default_factory=list)
    blocked_companies: list[str] = Field(default_factory=list)


class PrivacyScanIn(BaseModel):
    text: str = Field(default="", max_length=100_000)


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1)
    conversation_id: int | None = None
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)
    vision_attachment_ids: list[str] = Field(default_factory=list, max_length=4)
    web_search: bool = False


class ConversationIn(BaseModel):
    title: str = Field(default="新对话", max_length=80)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    status: Literal["active", "archived"] | None = None


class AgentSettingsIn(BaseModel):
    display_name: str = Field(default="BossCopilot", min_length=1, max_length=40)
    persona_role: str = Field(min_length=1, max_length=300)
    response_style: Literal["concise", "balanced", "detailed"] = "concise"
    custom_instructions: str = Field(default="", max_length=1000)
    profile_memory_enabled: bool = True
    conversation_memory_enabled: bool = True
    knowledge_memory_enabled: bool = True
    summary_enabled: bool = True
    context_message_limit: int = Field(default=12, ge=4, le=30)
    model_name: str = Field(default="gpt-5.5", min_length=1, max_length=120)
    model_base_url: str = Field(default="", max_length=500)
    api_key: str = Field(default="", max_length=500)

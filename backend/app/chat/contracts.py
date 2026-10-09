from typing import Literal

from pydantic import BaseModel, Field


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1)
    conversation_id: int | None = None
    model_profile_id: str | None = Field(default=None, min_length=1, max_length=120)
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)
    vision_attachment_ids: list[str] = Field(default_factory=list, max_length=4)
    web_search: bool = False
    web_search_mode: Literal["auto", "technical", "general"] = "auto"

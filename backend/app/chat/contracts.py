from typing import Literal

from pydantic import BaseModel, Field, StrictBool

from ..search_options import WebSearchProvider, WebSearchSourcePreference, WebSearchTopic


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1)
    conversation_id: int | None = None
    model_profile_id: str | None = Field(default=None, min_length=1, max_length=120)
    attachment_ids: list[str] = Field(default_factory=list, max_length=8)
    vision_attachment_ids: list[str] = Field(default_factory=list, max_length=4)
    web_search: StrictBool = False
    web_search_mode: Literal["auto", "technical", "general"] = "auto"
    web_search_topic: WebSearchTopic = "auto"
    web_search_source_preference: WebSearchSourcePreference = "none"
    # Expected original binding during retry/regeneration; never chooses a service.
    web_search_provider: WebSearchProvider | None = None

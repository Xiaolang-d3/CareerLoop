from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


SearchTopic = Literal["auto", "general", "news", "finance"]
SearchCategory = Literal["general", "news", "company"]
SearchSourcePreference = Literal["none", "technical"]
ServiceSearchTopic = Literal["general", "news", "finance", "company"]

TECHNICAL_DOMAINS = (
    "stackoverflow.com", "github.com", "developer.mozilla.org", "docs.python.org",
)


class SearchRequest(BaseModel):
    """A trusted turn's settings plus the model's research task hint."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    query: str = Field(min_length=2, max_length=500)
    count: int = Field(default=8, ge=1, le=10)
    topic: SearchTopic = "auto"
    source_preference: SearchSourcePreference = "none"
    task_category: SearchCategory = "general"


class SearchResponse(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    sources: list[dict[str, Any]]
    provider: Literal["tavily", "agent_search"]
    requested_topic: SearchTopic
    sent_topic: ServiceSearchTopic | None = None
    effective_topic: ServiceSearchTopic | None = None
    source_preference: SearchSourcePreference = "none"
    warnings: list[str] = Field(default_factory=list)


def legacy_search_request(query: str, count: int, mode: str) -> SearchRequest:
    # Legacy adapter callers still receive a source list. Production tools use
    # SearchRequest so category, source preference and task hints stay distinct.
    return SearchRequest(
        query=query,
        count=max(1, min(count, 10)),
        topic="general" if mode == "company" else mode,
        task_category=mode if mode in {"general", "news", "company"} else "general",
    )

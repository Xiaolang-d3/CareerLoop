from __future__ import annotations

from typing import Any, Protocol

from ..config import Settings
from .tavily import TavilySearchClient
from .web import AgentSearchClient


class PublicSearchClient(Protocol):
    async def search(self, query: str, count: int, *, mode: str = "general") -> list[dict[str, Any]]: ...

    async def enrich_sources(
        self, sources: list[dict[str, Any]], *, concurrency: int = 1,
    ) -> tuple[list[dict[str, Any]], list[dict[str, str]]]: ...


def build_public_search_client(settings: Settings) -> PublicSearchClient:
    if settings.resolved_web_search_provider == "tavily":
        return TavilySearchClient(
            api_key=settings.tavily_api_key or "",
            timeout_seconds=settings.web_research_timeout_seconds,
        )
    return AgentSearchClient(
        base_url=settings.agent_search_base_url,
        token=settings.agent_search_token,
        timeout_seconds=settings.web_research_timeout_seconds,
    )

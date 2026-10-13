from __future__ import annotations

from typing import Any, Protocol

from ..config import Settings
from ..search_options import WebSearchOptions
from .options import SearchRequest, SearchResponse
from .tavily import TavilySearchClient
from .web import AgentSearchClient, WebResearchError


class PublicSearchClient(Protocol):
    provider: str

    async def search(self, request: SearchRequest) -> SearchResponse: ...

    async def enrich_sources(
        self, sources: list[dict[str, Any]], *, concurrency: int = 1,
    ) -> tuple[list[dict[str, Any]], list[dict[str, str]]]: ...


def public_search_capabilities(provider: str) -> dict[str, Any]:
    """Adapter support, independently of credentials or current connectivity."""
    if provider == "tavily":
        return {
            "supported_topics": ["auto", "general", "news", "finance"],
            "supports_auto_parameters": True,
            "supports_technical_preference": True,
        }
    if provider == "agent_search":
        return {
            "supported_topics": ["auto", "general", "news"],
            "supports_auto_parameters": False,
            "supports_technical_preference": False,
        }
    return {
        "supported_topics": [],
        "supports_auto_parameters": False,
        "supports_technical_preference": False,
    }


def validate_search_options(options: WebSearchOptions, provider: str) -> None:
    if not options.enabled:
        raise WebResearchError("web_search_not_allowed", "本轮未开启联网搜索，请开启联网后重新提问")
    if options.provider is not None and options.provider != provider:
        raise WebResearchError(
            "web_search_provider_changed", "搜索服务已变更，请按当前搜索服务重新发送，原运行不会切换服务",
        )
    capabilities = public_search_capabilities(provider)
    if not capabilities["supported_topics"]:
        raise WebResearchError("web_search_provider_unsupported", "当前搜索服务不可用，请检查搜索服务配置")
    if options.topic not in capabilities["supported_topics"]:
        raise WebResearchError(
            "web_search_topic_unsupported", "当前搜索服务不支持金融类别，请选择其他类别后重新发送",
        )
    if options.source_preference == "technical" and not capabilities["supports_technical_preference"]:
        raise WebResearchError(
            "web_search_source_preference_unsupported",
            "当前搜索服务不支持优先技术资料，请选择不限来源后重新发送",
        )


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

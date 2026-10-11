"""Trusted, immutable per-turn search consent and preferences.

Models choose queries, while transport field presence determines user overrides.
Historical parsing is deliberately conservative: missing/invalid permission is off.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError


WebSearchTopic = Literal["auto", "general", "news", "finance"]
WebSearchSourcePreference = Literal["none", "technical"]
WebSearchProvider = Literal["tavily", "agent_search"]


class WebSearchOptions(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True)

    version: Literal[1] = 1
    enabled: bool = False
    topic: WebSearchTopic = "auto"
    source_preference: WebSearchSourcePreference = "none"
    provider: WebSearchProvider | None = None


def normalize_web_search_options(
    *,
    enabled: bool | None = None,
    topic: WebSearchTopic | None = None,
    source_preference: WebSearchSourcePreference | None = None,
    legacy_mode: Literal["auto", "technical", "general"] | None = None,
    base: WebSearchOptions | None = None,
    provider: WebSearchProvider | None = None,
) -> WebSearchOptions:
    """Apply only explicitly supplied fields over an inherited configuration."""
    values = (base or WebSearchOptions()).model_dump()
    if legacy_mode is not None:
        if legacy_mode not in {"auto", "technical", "general"}:
            raise ValueError("web_search_mode 必须是 auto、technical 或 general")
        values["topic"] = "auto" if legacy_mode == "auto" else "general"
        values["source_preference"] = "technical" if legacy_mode == "technical" else "none"
    if enabled is not None:
        values["enabled"] = enabled
    if topic is not None:
        values["topic"] = topic
    if source_preference is not None:
        values["source_preference"] = source_preference
    if provider is not None:
        values["provider"] = provider
    return WebSearchOptions.model_validate(values)


def web_search_options_from_payload(payload: Any) -> WebSearchOptions:
    """Read existing message data without inferring consent from content/tools."""
    if not isinstance(payload, dict):
        return WebSearchOptions()
    if "web_search_options" in payload:
        try:
            return WebSearchOptions.model_validate(payload["web_search_options"])
        except (ValidationError, TypeError, ValueError):
            return WebSearchOptions()
    try:
        return normalize_web_search_options(
            enabled=payload.get("web_search") if isinstance(payload.get("web_search"), bool) else False,
            legacy_mode=payload.get("web_search_mode"),
            topic=payload.get("web_search_topic"),
            source_preference=payload.get("web_search_source_preference"),
        )
    except (ValidationError, TypeError, ValueError):
        return WebSearchOptions()


def legacy_web_search_mode(options: WebSearchOptions) -> Literal["auto", "technical", "general"]:
    """Compatibility hint only; trusted consumers use the full options."""
    if options.source_preference == "technical":
        return "technical"
    return "auto" if options.topic == "auto" else "general"

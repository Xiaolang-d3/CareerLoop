from __future__ import annotations

from typing import Literal
from urllib.parse import urlsplit, urlunsplit


ModelProtocol = Literal["auto", "openai", "responses", "anthropic", "gemini", "ollama"]
ResolvedModelProtocol = Literal["openai", "responses", "anthropic", "gemini", "ollama"]

PROTOCOL_LABELS: dict[ResolvedModelProtocol, str] = {
    "openai": "OpenAI 兼容 Chat Completions",
    "responses": "OpenAI Responses API",
    "anthropic": "Anthropic Messages API",
    "gemini": "Google Gemini generateContent",
    "ollama": "Ollama Chat API",
}


def normalize_model_protocol(value: str | None) -> ModelProtocol:
    normalized = (value or "auto").strip().lower()
    if normalized in {"openai", "responses", "anthropic", "gemini", "ollama"}:
        return normalized  # type: ignore[return-value]
    return "auto"


def resolve_model_protocol(
    model_name: str,
    configured: str | None = "auto",
    base_url: str = "",
) -> ResolvedModelProtocol:
    protocol = normalize_model_protocol(configured)
    if protocol != "auto":
        return protocol
    normalized_model = model_name.strip().lower()
    normalized_url = base_url.strip().lower()
    if "anthropic.com" in normalized_url:
        return "anthropic"
    if "generativelanguage.googleapis.com" in normalized_url:
        return "gemini"
    if "ollama" in normalized_url or ":11434" in normalized_url:
        return "ollama"
    # Multi-protocol gateways commonly expose both native and compatibility
    # endpoints. Prefer the model family's native wire format; a user can
    # still force a compatibility protocol with an explicit selection.
    if "claude" in normalized_model:
        return "anthropic"
    if "gemini" in normalized_model:
        return "gemini"
    return "openai"


def model_protocol_candidates(
    model_name: str,
    configured: str | None = "auto",
    base_url: str = "",
) -> tuple[ResolvedModelProtocol, ...]:
    """Return the ordered protocols that auto mode may safely negotiate."""
    protocol = normalize_model_protocol(configured)
    primary = resolve_model_protocol(model_name, protocol, base_url)
    if protocol != "auto":
        return (primary,)
    normalized_url = base_url.strip().lower()
    if not normalized_url:
        return (primary,)
    if any(
        marker in normalized_url
        for marker in ("anthropic.com", "generativelanguage.googleapis.com", "ollama", ":11434")
    ):
        return (primary,)
    if primary in {"anthropic", "gemini"}:
        return (primary, "openai")
    return (primary,)


def base_url_for_protocol(
    base_url: str | None,
    protocol: ResolvedModelProtocol,
    *,
    fallback: bool = False,
) -> str | None:
    """Adapt only a root URL when negotiating a standard compatibility route."""
    normalized = (base_url or "").strip().rstrip("/")
    if not normalized or protocol != "openai" or not fallback:
        return normalized or None
    parsed = urlsplit(normalized)
    if parsed.path not in {"", "/"}:
        return normalized
    return urlunsplit((parsed.scheme, parsed.netloc, "/v1", parsed.query, parsed.fragment))


def protocol_requires_api_key(protocol: str) -> bool:
    return normalize_model_protocol(protocol) != "ollama"


def model_protocol_label(
    model_name: str,
    configured: str | None = "auto",
    base_url: str = "",
) -> str:
    return PROTOCOL_LABELS[resolve_model_protocol(model_name, configured, base_url)]

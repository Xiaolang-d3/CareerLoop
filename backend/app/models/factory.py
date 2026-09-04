from __future__ import annotations

from .anthropic_messages import AnthropicMessagesProvider
from .auto_negotiating import AutoNegotiatingModelProvider, protocol_cache_key
from .gemini_generate_content import GeminiGenerateContentProvider
from .ollama_chat import OllamaChatProvider
from .openai_compatible import OpenAICompatibleProvider
from .openai_responses import OpenAIResponsesProvider
from ..model_protocol import base_url_for_protocol, model_protocol_candidates, normalize_model_protocol


def build_model_provider(
    *,
    api_key: str,
    model: str,
    base_url: str | None = None,
    timeout_seconds: float = 60,
    protocol: str = "auto",
):
    provider_classes = {
        "openai": OpenAICompatibleProvider,
        "responses": OpenAIResponsesProvider,
        "anthropic": AnthropicMessagesProvider,
        "gemini": GeminiGenerateContentProvider,
        "ollama": OllamaChatProvider,
    }
    candidates = model_protocol_candidates(model, protocol, base_url or "")
    providers = [
        (
            candidate,
            provider_classes[candidate](
                api_key=api_key,
                model=model,
                base_url=base_url_for_protocol(
                    base_url,
                    candidate,
                    fallback=index > 0,
                ),
                timeout_seconds=timeout_seconds,
            ),
        )
        for index, candidate in enumerate(candidates)
    ]
    if normalize_model_protocol(protocol) != "auto" or len(providers) == 1:
        return providers[0][1]
    return AutoNegotiatingModelProvider(
        providers,
        protocol_cache_key(base_url, model, api_key),
    )

from __future__ import annotations

import asyncio
import unittest

from app.domain import AgentMessage, ModelRequest, ModelResponse
from app.model_protocol import model_protocol_candidates
from app.models.auto_negotiating import AutoNegotiatingModelProvider, clear_protocol_cache
from app.models.base import ModelProviderError
from app.models.factory import build_model_provider
from app.models.openai_compatible import _rejects_chat_completions


class _Provider:
    def __init__(self, name: str, error_code: str | None = None) -> None:
        self.name, self.error_code, self.calls = name, error_code, []

    async def generate(self, request: ModelRequest) -> ModelResponse:
        self.calls.append("generate")
        if self.error_code:
            raise ModelProviderError(self.error_code, "rejected")
        return ModelResponse(content=self.name)


class ResponsesFallbackTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_protocol_cache()

    def test_auto_openai_family_negotiates_responses_second(self) -> None:
        self.assertEqual(model_protocol_candidates("grok-4.7", "auto", "https://gateway.example/v1"), ("openai", "responses"))
        self.assertEqual(model_protocol_candidates("gpt-5.5", "auto", ""), ("openai", "responses"))
        self.assertEqual(model_protocol_candidates("grok-4.7", "openai", "https://gateway.example/v1"), ("openai",))
        self.assertEqual(model_protocol_candidates("qwen3", "auto", "http://localhost:11434"), ("ollama",))

    def test_factory_builds_negotiating_provider_for_auto_openai(self) -> None:
        provider = build_model_provider(api_key="key", model="grok-4.7", base_url="https://gateway.example/v1", protocol="auto")
        self.assertIsInstance(provider, AutoNegotiatingModelProvider)

    def test_detects_explicit_chat_completions_rejection(self) -> None:
        self.assertTrue(_rejects_chat_completions("模型 grok-4.7 不支持 chat completions 协议 (request id: x)"))
        self.assertTrue(_rejects_chat_completions("This model is only supported in v1/responses and not in v1/chat/completions. unsupported"))
        self.assertFalse(_rejects_chat_completions("max_tokens is not supported"))
        self.assertFalse(_rejects_chat_completions("invalid api key"))

    def test_falls_back_to_responses_when_chat_completions_is_rejected(self) -> None:
        chat = _Provider("openai", error_code="protocol_unsupported")
        responses = _Provider("responses")
        provider = AutoNegotiatingModelProvider([("openai", chat), ("responses", responses)], "grok-key")
        request = ModelRequest(messages=[AgentMessage(role="user", content="hi")])
        self.assertEqual(asyncio.run(provider.generate(request)).content, "responses")
        self.assertEqual(provider.name, "responses")


if __name__ == "__main__":
    unittest.main()

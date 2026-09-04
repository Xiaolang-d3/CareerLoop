from __future__ import annotations

import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app.domain import AgentMessage, ModelRequest, ModelResponse, ModelStreamEvent, ToolDefinition
from app.model_protocol import (
    base_url_for_protocol,
    model_protocol_candidates,
    model_protocol_label,
    protocol_requires_api_key,
    resolve_model_protocol,
)
from app.models.auto_negotiating import AutoNegotiatingModelProvider, clear_protocol_cache
from app.models.base import ModelProviderError
from app.models.factory import build_model_provider
from app.models.gemini_generate_content import GeminiGenerateContentProvider
from app.models.ollama_chat import OllamaChatProvider
from app.models.openai_responses import OpenAIResponsesProvider


class ProtocolResolutionTest(unittest.TestCase):
    def test_auto_resolves_protocols_with_unambiguous_signals(self) -> None:
        self.assertEqual(resolve_model_protocol("gemini-2.5-flash", "auto"), "gemini")
        self.assertEqual(
            resolve_model_protocol("custom", "auto", "https://generativelanguage.googleapis.com/v1beta"),
            "gemini",
        )
        self.assertEqual(resolve_model_protocol("qwen3", "auto", "http://localhost:11434"), "ollama")
        self.assertEqual(resolve_model_protocol("gpt-5.5", "responses"), "responses")
        self.assertEqual(model_protocol_label("gpt-5.5", "responses"), "OpenAI Responses API")

    def test_only_ollama_allows_an_empty_key(self) -> None:
        self.assertFalse(protocol_requires_api_key("ollama"))
        for protocol in ("openai", "responses", "anthropic", "gemini"):
            self.assertTrue(protocol_requires_api_key(protocol))

    def test_custom_gateway_uses_native_family_then_compatibility(self) -> None:
        self.assertEqual(
            model_protocol_candidates("claude-sonnet-5", "auto", "https://gateway.example.test"),
            ("anthropic", "openai"),
        )
        self.assertEqual(
            base_url_for_protocol("https://gateway.example.test", "openai", fallback=True),
            "https://gateway.example.test/v1",
        )
        self.assertEqual(
            base_url_for_protocol("https://gateway.example.test/api", "openai", fallback=True),
            "https://gateway.example.test/api",
        )
        self.assertEqual(
            model_protocol_candidates("claude-sonnet-5", "openai", "https://gateway.example.test"),
            ("openai",),
        )

    def test_factory_selects_each_native_provider(self) -> None:
        self.assertIsInstance(
            build_model_provider(api_key="key", model="gpt-5.5", protocol="responses"),
            OpenAIResponsesProvider,
        )
        self.assertIsInstance(
            build_model_provider(api_key="key", model="gemini-2.5-flash", protocol="auto"),
            GeminiGenerateContentProvider,
        )
        self.assertIsInstance(
            build_model_provider(
                api_key="",
                model="qwen3",
                base_url="http://localhost:11434",
                protocol="auto",
            ),
            OllamaChatProvider,
        )


class FakeProvider:
    def __init__(self, name: str, *, error_code: str = "", stream_after_event: bool = False) -> None:
        self.name = name
        self.models_url = f"https://gateway.example.test/{name}/models"
        self.error_code = error_code
        self.stream_after_event = stream_after_event
        self.calls: list[str] = []

    def _raise(self) -> None:
        if self.error_code:
            raise ModelProviderError(self.error_code, self.error_code, retryable=True)

    async def generate(self, _request: ModelRequest) -> ModelResponse:
        self.calls.append("generate")
        self._raise()
        return ModelResponse(content=self.name)

    async def check_connection(self) -> None:
        self.calls.append("check_connection")
        self._raise()

    async def list_models(self) -> list[str]:
        self.calls.append("list_models")
        self._raise()
        return [self.name]

    async def probe_vision(self) -> dict[str, str]:
        self.calls.append("probe_vision")
        self._raise()
        return {"status": "supported", "source": "probe", "detail": self.name}

    async def stream(self, _request: ModelRequest):
        self.calls.append("stream")
        if self.stream_after_event:
            yield ModelStreamEvent(type="text_delta", delta="partial")
        self._raise()
        yield ModelStreamEvent(type="completed", response=ModelResponse(content=self.name))


class AutoNegotiatingProviderTest(unittest.TestCase):
    def setUp(self) -> None:
        clear_protocol_cache()
        self.request = ModelRequest(messages=[AgentMessage(role="user", content="hello")])

    def test_falls_back_only_for_a_protocol_mismatch_and_caches_success(self) -> None:
        native = FakeProvider("anthropic", error_code="invalid_provider_response")
        compatible = FakeProvider("openai")
        provider = AutoNegotiatingModelProvider(
            [("anthropic", native), ("openai", compatible)],
            "gateway-model-key",
        )

        response = asyncio.run(provider.generate(self.request))

        self.assertEqual(response.content, "openai")
        self.assertEqual(native.calls, ["generate"])
        self.assertEqual(compatible.calls, ["generate"])
        cached_native = FakeProvider("anthropic")
        cached_compatible = FakeProvider("openai")
        cached = AutoNegotiatingModelProvider(
            [("anthropic", cached_native), ("openai", cached_compatible)],
            "gateway-model-key",
        )
        self.assertEqual(asyncio.run(cached.generate(self.request)).content, "openai")
        self.assertEqual(cached_native.calls, [])

    def test_does_not_fallback_for_account_pool_or_other_upstream_failures(self) -> None:
        for error_code in ("account_pool_exhausted", "authentication_failed", "rate_limited", "provider_error"):
            native = FakeProvider("anthropic", error_code=error_code)
            compatible = FakeProvider("openai")
            provider = AutoNegotiatingModelProvider(
                [("anthropic", native), ("openai", compatible)],
                f"key-{error_code}",
            )
            with self.assertRaises(ModelProviderError) as caught:
                asyncio.run(provider.generate(self.request))
            self.assertEqual(caught.exception.code, error_code)
            self.assertEqual(compatible.calls, [])

    def test_stream_never_retries_after_content_was_emitted(self) -> None:
        native = FakeProvider(
            "anthropic",
            error_code="invalid_provider_response",
            stream_after_event=True,
        )
        compatible = FakeProvider("openai")
        provider = AutoNegotiatingModelProvider(
            [("anthropic", native), ("openai", compatible)],
            "stream-key",
        )

        async def collect() -> list[ModelStreamEvent]:
            return [event async for event in provider.stream(self.request)]

        with self.assertRaises(ModelProviderError):
            asyncio.run(collect())
        self.assertEqual(compatible.calls, [])


class OpenAIResponsesProviderTest(unittest.TestCase):
    def test_generate_maps_input_tools_and_function_calls(self) -> None:
        provider = OpenAIResponsesProvider(
            api_key="test-key",
            model="gpt-test",
            base_url="https://gateway.example.test/v1",
        )
        upstream = SimpleNamespace(
            id="resp_1",
            model="gpt-test",
            status="completed",
            output_text="我来查询。",
            output=[
                SimpleNamespace(
                    type="function_call",
                    id="fc_1",
                    call_id="call_1",
                    name="lookup",
                    arguments='{"q":"x"}',
                )
            ],
            usage=SimpleNamespace(input_tokens=10, output_tokens=4, total_tokens=14),
        )
        create = AsyncMock(return_value=upstream)
        with patch.object(provider._client.responses, "create", new=create):
            response = asyncio.run(
                provider.generate(
                    ModelRequest(
                        messages=[AgentMessage(role="user", content="查询")],
                        tools=[
                            ToolDefinition(
                                name="lookup",
                                description="查询",
                                input_schema={"type": "object", "properties": {"q": {"type": "string"}}},
                            )
                        ],
                    )
                )
            )

        arguments = create.await_args.kwargs
        self.assertFalse(arguments["store"])
        self.assertEqual(arguments["input"][0], {"role": "user", "content": "查询"})
        self.assertEqual(arguments["tools"][0]["name"], "lookup")
        self.assertEqual(response.content, "我来查询。")
        self.assertEqual(response.tool_calls[0].arguments, {"q": "x"})
        self.assertEqual(response.usage.total_tokens, 14)
        self.assertEqual(response.provider_metadata["protocol"], "responses")

    def test_stream_uses_completed_response_for_tool_calls(self) -> None:
        provider = OpenAIResponsesProvider(api_key="test-key", model="gpt-test")
        completed = SimpleNamespace(
            id="resp_2",
            model="gpt-test",
            status="completed",
            output_text="好",
            output=[],
            usage=SimpleNamespace(input_tokens=2, output_tokens=1, total_tokens=3),
        )

        class Stream:
            def __aiter__(self):
                async def events():
                    yield SimpleNamespace(type="response.output_text.delta", delta="好")
                    yield SimpleNamespace(type="response.completed", response=completed)

                return events()

            async def close(self):
                return None

        with patch.object(provider._client.responses, "create", new=AsyncMock(return_value=Stream())):
            async def collect():
                return [event async for event in provider.stream(ModelRequest(messages=[AgentMessage(role="user", content="hi")]))]

            events = asyncio.run(collect())

        self.assertEqual(events[0].delta, "好")
        self.assertEqual(events[-1].response.content, "好")
        self.assertEqual(events[-1].response.usage.total_tokens, 3)


def gemini_provider(handler) -> GeminiGenerateContentProvider:
    provider = GeminiGenerateContentProvider(
        api_key="gemini-key",
        model="gemini-test",
        base_url="https://generativelanguage.googleapis.com/v1beta",
    )
    provider._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        headers={"x-goog-api-key": "gemini-key", "content-type": "application/json"},
    )
    return provider


class GeminiGenerateContentProviderTest(unittest.TestCase):
    def test_http_200_landing_payload_is_a_protocol_mismatch(self) -> None:
        provider = gemini_provider(
            lambda _request: httpx.Response(200, json={"message": "gateway home"})
        )

        with self.assertRaises(ModelProviderError) as caught:
            asyncio.run(
                provider.generate(
                    ModelRequest(messages=[AgentMessage(role="user", content="hi")])
                )
            )

        self.assertEqual(caught.exception.code, "invalid_provider_response")

    def test_generate_uses_native_path_and_maps_function_calls(self) -> None:
        requested: list[tuple[str, dict, str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append((str(request.url), json.loads(request.content), request.headers["x-goog-api-key"]))
            return httpx.Response(
                200,
                json={
                    "responseId": "gemini-1",
                    "candidates": [
                        {
                            "finishReason": "STOP",
                            "content": {
                                "parts": [
                                    {"text": "查询中"},
                                    {"functionCall": {"id": "call-1", "name": "lookup", "args": {"q": "x"}}},
                                ]
                            },
                        }
                    ],
                    "usageMetadata": {
                        "promptTokenCount": 5,
                        "candidatesTokenCount": 2,
                        "totalTokenCount": 7,
                    },
                },
            )

        provider = gemini_provider(handler)
        result = asyncio.run(
            provider.generate(
                ModelRequest(
                    messages=[AgentMessage(role="user", content="查询")],
                    tools=[ToolDefinition(name="lookup", description="查询", input_schema={"type": "object"})],
                )
            )
        )

        self.assertEqual(
            requested[0][0],
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
        )
        self.assertEqual(requested[0][2], "gemini-key")
        self.assertEqual(requested[0][1]["tools"][0]["functionDeclarations"][0]["name"], "lookup")
        self.assertEqual(result.tool_calls[0].arguments, {"q": "x"})
        self.assertEqual(result.usage.total_tokens, 7)

    def test_stream_parses_sse_and_catalog_strips_models_prefix(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/models"):
                return httpx.Response(200, json={"models": [{"name": "models/gemini-b"}, {"name": "models/gemini-a"}]})
            body = "data: " + json.dumps(
                {
                    "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "好"}]}}],
                    "usageMetadata": {"promptTokenCount": 2, "candidatesTokenCount": 1, "totalTokenCount": 3},
                }
            ) + "\n\n"
            return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

        provider = gemini_provider(handler)

        async def collect():
            events = [event async for event in provider.stream(ModelRequest(messages=[AgentMessage(role="user", content="hi")]))]
            return events, await provider.list_models()

        events, models = asyncio.run(collect())
        self.assertEqual(events[0].delta, "好")
        self.assertEqual(events[-1].response.usage.total_tokens, 3)
        self.assertEqual(models, ["gemini-a", "gemini-b"])


def ollama_provider(handler, base_url: str = "http://localhost:11434") -> OllamaChatProvider:
    provider = OllamaChatProvider(api_key="", model="qwen3", base_url=base_url)
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return provider


class OllamaChatProviderTest(unittest.TestCase):
    def test_empty_key_native_chat_and_tool_call(self) -> None:
        requested: list[tuple[str, dict, str | None]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append((str(request.url), json.loads(request.content), request.headers.get("authorization")))
            return httpx.Response(
                200,
                json={
                    "model": "qwen3",
                    "done": True,
                    "done_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [{"function": {"name": "lookup", "arguments": {"q": "x"}}}],
                    },
                    "prompt_eval_count": 4,
                    "eval_count": 2,
                },
            )

        provider = ollama_provider(handler)
        result = asyncio.run(
            provider.generate(
                ModelRequest(
                    messages=[AgentMessage(role="user", content="查询")],
                    tools=[ToolDefinition(name="lookup", description="查询", input_schema={"type": "object"})],
                )
            )
        )

        self.assertEqual(requested[0][0], "http://localhost:11434/api/chat")
        self.assertIsNone(requested[0][2])
        self.assertFalse(requested[0][1]["stream"])
        self.assertEqual(result.tool_calls[0].name, "lookup")
        self.assertEqual(result.usage.total_tokens, 6)

    def test_stream_ndjson_and_api_root_catalog(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/tags"):
                return httpx.Response(200, json={"models": [{"name": "qwen3"}, {"model": "gemma3"}]})
            body = "\n".join(
                [
                    json.dumps({"message": {"role": "assistant", "content": "你"}, "done": False}),
                    json.dumps({"message": {"role": "assistant", "content": "好"}, "done": True, "done_reason": "stop", "prompt_eval_count": 2, "eval_count": 2}),
                ]
            )
            return httpx.Response(200, text=body, headers={"content-type": "application/x-ndjson"})

        provider = ollama_provider(handler, "http://localhost:11434/api/")

        async def collect():
            events = [event async for event in provider.stream(ModelRequest(messages=[AgentMessage(role="user", content="hi")]))]
            return events, await provider.list_models()

        events, models = asyncio.run(collect())
        self.assertEqual([event.delta for event in events[:-1]], ["你", "好"])
        self.assertEqual(events[-1].response.content, "你好")
        self.assertEqual(models, ["gemma3", "qwen3"])


if __name__ == "__main__":
    unittest.main()

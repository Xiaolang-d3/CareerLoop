from __future__ import annotations

import asyncio
import json
import unittest

import httpx

from app.domain import AgentMessage, ModelRequest, ToolDefinition
from app.model_protocol import model_protocol_label, resolve_model_protocol
from app.models.anthropic_messages import AnthropicMessagesProvider
from app.models.base import ModelProviderError
from app.models.factory import build_model_provider


def provider_with_handler(handler, base_url: str = "https://gateway.example.test"):
    provider = AnthropicMessagesProvider(
        api_key="test-key",
        model="claude-sonnet-5-thinking",
        base_url=base_url,
        timeout_seconds=5,
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return provider


class ModelProtocolTest(unittest.TestCase):
    def test_auto_matches_claude_without_a_custom_url_and_anthropic_hosts(self) -> None:
        self.assertEqual(resolve_model_protocol("claude-sonnet-5", "auto"), "anthropic")
        self.assertEqual(
            resolve_model_protocol("custom-model", "auto", "https://api.anthropic.com"),
            "anthropic",
        )
        self.assertEqual(resolve_model_protocol("gpt-5.5", "auto"), "openai")
        self.assertEqual(model_protocol_label("claude-opus-4", "auto"), "Anthropic Messages API")

    def test_custom_gateway_with_a_claude_model_prefers_native_messages(self) -> None:
        self.assertEqual(
            resolve_model_protocol(
                "claude-sonnet-5-thinking",
                "auto",
                "https://api.zyuou.com/",
            ),
            "anthropic",
        )

    def test_explicit_override_wins_over_model_name(self) -> None:
        self.assertEqual(resolve_model_protocol("claude-sonnet-5", "openai"), "openai")
        provider = build_model_provider(
            api_key="test-key",
            model="claude-sonnet-5",
            base_url="https://gateway.example.test",
            protocol="openai",
        )
        self.assertEqual(provider.name, "openai")


class AnthropicMessagesProviderTest(unittest.TestCase):
    def test_http_200_landing_payload_is_a_protocol_mismatch(self) -> None:
        provider = provider_with_handler(
            lambda _request: httpx.Response(200, json={"message": "gateway home"})
        )

        with self.assertRaises(ModelProviderError) as caught:
            asyncio.run(
                provider.generate(
                    ModelRequest(messages=[AgentMessage(role="user", content="hi")])
                )
            )

        self.assertEqual(caught.exception.code, "invalid_provider_response")

    def test_empty_http_200_stream_is_a_protocol_mismatch(self) -> None:
        provider = provider_with_handler(
            lambda _request: httpx.Response(
                200,
                text="",
                headers={"content-type": "text/event-stream"},
            )
        )

        async def collect():
            return [
                event
                async for event in provider.stream(
                    ModelRequest(messages=[AgentMessage(role="user", content="hi")])
                )
            ]

        with self.assertRaises(ModelProviderError) as caught:
            asyncio.run(collect())
        self.assertEqual(caught.exception.code, "invalid_provider_response")

    def test_root_base_url_uses_v1_messages_and_converts_tools(self) -> None:
        requested: list[tuple[str, dict]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append((str(request.url), json.loads(request.content)))
            return httpx.Response(
                200,
                json={
                    "id": "msg_123",
                    "model": "claude-sonnet-5-thinking",
                    "stop_reason": "tool_use",
                    "usage": {"input_tokens": 12, "output_tokens": 5},
                    "content": [
                        {"type": "text", "text": "我来查询。"},
                        {"type": "tool_use", "id": "tool_1", "name": "lookup", "input": {"q": "x"}},
                    ],
                },
            )

        provider = provider_with_handler(handler)
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

        self.assertEqual(requested[0][0], "https://gateway.example.test/v1/messages")
        self.assertEqual(requested[0][1]["tools"][0]["name"], "lookup")
        self.assertEqual(response.content, "我来查询。")
        self.assertEqual(response.tool_calls[0].arguments, {"q": "x"})
        self.assertEqual(response.usage.total_tokens, 17)

    def test_system_messages_stay_in_system_and_required_tools_use_any(self) -> None:
        requested: list[dict] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "id": "msg_456",
                    "model": "claude-sonnet-5-thinking",
                    "stop_reason": "tool_use",
                    "usage": {"input_tokens": 4, "output_tokens": 2},
                    "content": [
                        {"type": "tool_use", "id": "tool_2", "name": "lookup", "input": {}},
                    ],
                },
            )

        provider = provider_with_handler(handler)
        asyncio.run(
            provider.generate(
                ModelRequest(
                    messages=[
                        AgentMessage(role="system", content="必须先核验来源"),
                        AgentMessage(role="user", content="查询"),
                    ],
                    tools=[
                        ToolDefinition(
                            name="lookup",
                            description="查询",
                            input_schema={"type": "object"},
                        )
                    ],
                    tool_choice="required",
                )
            )
        )

        body = requested[0]
        self.assertIn("必须先核验来源", body["system"])
        self.assertEqual(body["messages"], [{"role": "user", "content": "查询"}])
        self.assertEqual(body["tool_choice"], {"type": "any"})

    def test_explicit_v1_base_url_is_not_duplicated(self) -> None:
        requested: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append(str(request.url))
            return httpx.Response(200, json={"data": [{"id": "claude-b"}, {"id": "claude-a"}]})

        provider = provider_with_handler(handler, "https://gateway.example.test/v1/")
        models = asyncio.run(provider.list_models())

        self.assertEqual(requested, ["https://gateway.example.test/v1/models"])
        self.assertEqual(models, ["claude-a", "claude-b"])

    def test_stream_emits_text_tool_call_and_completion(self) -> None:
        events = [
            {"type": "message_start", "message": {"id": "msg_1", "model": "claude-test", "usage": {"input_tokens": 4}}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "好"}},
            {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "tool_1", "name": "lookup"}},
            {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"q\":\"x\"}"}},
            {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 3}},
            {"type": "message_stop"},
        ]
        body = "\n\n".join(f"event: x\ndata: {json.dumps(event)}" for event in events) + "\n\n"

        provider = provider_with_handler(
            lambda _request: httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})
        )

        async def collect():
            return [event async for event in provider.stream(ModelRequest(messages=[AgentMessage(role="user", content="hi")]))]

        streamed = asyncio.run(collect())
        self.assertEqual(streamed[0].delta, "好")
        completed = streamed[-1].response
        self.assertEqual(completed.tool_calls[0].name, "lookup")
        self.assertEqual(completed.tool_calls[0].arguments, {"q": "x"})
        self.assertEqual(completed.usage.total_tokens, 7)


if __name__ == "__main__":
    unittest.main()

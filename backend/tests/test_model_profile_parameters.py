"""Profile limits must reach each protocol's actual HTTP request."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from openai import AsyncOpenAI

from app.domain import AgentMessage, ModelRequest
from app.models.configured import configure_model_provider
from app.models.factory import build_model_provider


RESPONSES = {
    "openai": {"id": "test", "object": "chat.completion", "created": 1, "model": "test", "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "ok"}}]},
    "responses": {"id": "test", "object": "response", "status": "completed", "output": [{"type": "message", "id": "m", "role": "assistant", "status": "completed", "content": [{"type": "output_text", "text": "ok", "annotations": []}]}]},
    "anthropic": {"id": "test", "type": "message", "stop_reason": "end_turn", "content": [{"type": "text", "text": "ok"}]},
    "gemini": {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "ok"}]}}]},
    "ollama": {"done": True, "message": {"role": "assistant", "content": "ok"}},
}


@pytest.mark.parametrize("protocol,nested,output_field", [
    ("openai", None, "max_tokens"), ("responses", None, "max_output_tokens"),
    ("anthropic", None, "max_tokens"), ("gemini", "generationConfig", "maxOutputTokens"),
    ("ollama", "options", "num_predict"),
])
def test_profile_parameters_reach_real_request_payload(protocol, nested, output_field, monkeypatch):
    sent = []
    def handler(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json=RESPONSES[protocol])

    monkeypatch.setattr(f"app.models.{'openai_compatible' if protocol == 'openai' else 'openai_responses' if protocol == 'responses' else 'anthropic_messages' if protocol == 'anthropic' else 'gemini_generate_content' if protocol == 'gemini' else 'ollama_chat'}.get_agent_settings", lambda: {})

    async def run():
        provider = build_model_provider(api_key="synthetic-key", model="test", protocol=protocol, base_url="https://model.example.test/v1")
        if protocol in {"openai", "responses"}:
            await provider._client.close()
        else:
            await provider._client.aclose()
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        provider._client = AsyncOpenAI(api_key="synthetic-key", base_url="https://model.example.test/v1", http_client=client, max_retries=0) if protocol in {"openai", "responses"} else client
        wrapped = configure_model_provider(provider, {"temperature": 0, "max_output_tokens": 123})
        try:
            result = await wrapped.generate(ModelRequest(messages=[AgentMessage(role="user", content="hi")]))
            assert result.content == "ok"
        finally:
            await client.aclose()

    asyncio.run(run())
    parameters = sent[0][nested] if nested else sent[0]
    assert parameters["temperature"] == 0
    assert parameters[output_field] == 123
    assert "parameters" not in sent[0]


def test_profile_limit_cannot_increase_and_stream_uses_same_bound_copy():
    requests = []
    async def stream(request):
        requests.append(request)
        if False:
            yield
    provider = SimpleNamespace(generate=AsyncMock(), stream=stream)
    profile = {"temperature": 0.25, "max_output_tokens": 100}
    wrapped = configure_model_provider(provider, profile)
    profile["max_output_tokens"] = 999
    request = ModelRequest(messages=[], parameters={"max_output_tokens": 200})
    async def run():
        await wrapped.generate(request)
        async for _ in wrapped.stream(request):
            pass
        await wrapped.generate(request.model_copy(update={"parameters": {"max_output_tokens": 20}}))
    asyncio.run(run())
    assert provider.generate.call_args_list[0].args[0].parameters == {"temperature": 0.25, "max_output_tokens": 100}
    assert requests[0].parameters["max_output_tokens"] == 100
    assert provider.generate.call_args_list[1].args[0].parameters["max_output_tokens"] == 20
    assert request.parameters == {"max_output_tokens": 200}

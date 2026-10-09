from __future__ import annotations

import asyncio
from copy import deepcopy
from unittest.mock import Mock

import httpx
import pytest
from openai import AsyncOpenAI

from app.agent.model_capabilities import apply_actual_protocol, infer_model_capabilities
from app.models.auto_negotiating import _SUCCESSFUL_PROTOCOLS, clear_protocol_cache, get_effective_model_protocol, get_negotiated_model_protocol
from app.models.base import ModelProviderError
from app.models.factory import build_model_provider
from app.models.openai_compatible import OpenAICompatibleProvider
from app.observability.model_monitor import _monitor_candidate_pairs


PROTOCOLS = ("openai", "responses", "anthropic", "gemini", "ollama")
BASE_URL = "https://gateway.example.test"
SYNTHETIC_KEY = "offline-test-key"

VALID_BODIES = {
    "openai": {
        "id": "chat-test", "model": "test-model", "object": "chat.completion",
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "OK"}}],
    },
    "responses": {
        "id": "resp-test", "model": "test-model", "status": "completed",
        "output": [{"type": "message", "id": "msg-test", "status": "completed", "role": "assistant", "content": [{"type": "output_text", "text": "OK", "annotations": []}]}],
    },
    "anthropic": {
        "id": "msg-test", "model": "test-model", "type": "message",
        "content": [{"type": "text", "text": "OK"}], "stop_reason": "end_turn",
    },
    "gemini": {"candidates": [{"content": {"parts": [{"text": "OK"}]}, "finishReason": "STOP"}]},
    "ollama": {"model": "test-model", "done": True, "message": {"role": "assistant", "content": "OK"}},
}

EMPTY_ENVELOPES = {
    "openai": {"choices": [{"message": {}}]},
    "responses": {"status": "completed", "output": []},
    "anthropic": {"content": []},
    "gemini": {"candidates": [{}]},
    "ollama": {"message": {}},
}

TRUNCATED_BODIES = {
    "openai": {"choices": [{"message": {"role": "assistant", "content": ""}, "finish_reason": "length"}], "usage": {"prompt_tokens": 1, "completion_tokens": 4, "total_tokens": 5}},
    "responses": {"status": "incomplete", "output": [], "incomplete_details": {"reason": "max_output_tokens"}, "usage": {"input_tokens": 1, "output_tokens": 4, "total_tokens": 5}},
    "anthropic": {"content": [], "stop_reason": "max_tokens", "usage": {"input_tokens": 1, "output_tokens": 4}},
    "gemini": {"candidates": [{"finishReason": "MAX_TOKENS"}], "usageMetadata": {"promptTokenCount": 1, "candidatesTokenCount": 4, "totalTokenCount": 5}},
    "ollama": {"message": {"content": ""}, "done": True, "done_reason": "length", "prompt_eval_count": 1, "eval_count": 4},
}

REFUSAL_BODIES = {
    "openai": {"choices": [{"message": {"role": "assistant", "content": None, "refusal": "Cannot answer"}, "finish_reason": "stop"}]},
    "responses": {"status": "completed", "output": [{"type": "message", "role": "assistant", "content": [{"type": "refusal", "refusal": "Cannot answer"}]}]},
    "anthropic": {"content": [], "stop_reason": "refusal"},
    "gemini": {"candidates": [{"finishReason": "SAFETY"}]},
    "ollama": {"message": {"role": "assistant", "content": "Cannot answer"}, "done": True},
}


@pytest.fixture(autouse=True)
def reset_protocol_cache():
    clear_protocol_cache()
    yield
    clear_protocol_cache()


async def mock_client(provider, handler):
    if isinstance(provider, OpenAICompatibleProvider):
        await provider._client.close()
        provider._client = AsyncOpenAI(
            api_key=SYNTHETIC_KEY,
            base_url=BASE_URL,
            max_retries=0,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
    else:
        await provider._client.aclose()
        provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider._record_event = Mock()


async def close_client(provider):
    if isinstance(provider, OpenAICompatibleProvider):
        await provider._client.close()
    else:
        await provider._client.aclose()


async def provider_for(protocol, handler):
    provider = build_model_provider(
        api_key=SYNTHETIC_KEY, model="test-model", base_url=BASE_URL, protocol=protocol,
    )
    await mock_client(provider, handler)
    return provider


@pytest.mark.parametrize("protocol", PROTOCOLS)
@pytest.mark.parametrize("method", ("probe_vision", "check_connection"))
@pytest.mark.parametrize("body_kind", ("json", "html"))
def test_invalid_http_200_does_not_mark_connection_or_vision_success(protocol, method, body_kind):
    def invalid_reply(_request):
        if body_kind == "html":
            return httpx.Response(200, text="<html>Gateway home</html>", headers={"content-type": "text/html"})
        return httpx.Response(200, json={"message": "Gateway home"})

    async def scenario():
        provider = await provider_for(protocol, invalid_reply)
        try:
            with pytest.raises(ModelProviderError) as caught:
                await getattr(provider, method)()
            assert caught.value.code == "invalid_provider_response"
            assert provider._record_event.call_args.kwargs["error"] is caught.value
        finally:
            await close_client(provider)

    asyncio.run(scenario())


@pytest.mark.parametrize("protocol", PROTOCOLS)
@pytest.mark.parametrize("method", ("probe_vision", "check_connection"))
def test_valid_native_and_sdk_responses_remain_accepted(protocol, method):
    async def scenario():
        provider = await provider_for(protocol, lambda _request: httpx.Response(200, json=VALID_BODIES[protocol]))
        try:
            result = await getattr(provider, method)()
            if method == "probe_vision":
                assert result["status"] == "supported"
                assert result["source"] == "probe"
            assert "error" not in provider._record_event.call_args.kwargs
        finally:
            await close_client(provider)

    asyncio.run(scenario())


@pytest.mark.parametrize("protocol", PROTOCOLS)
@pytest.mark.parametrize("method", ("probe_vision", "check_connection"))
@pytest.mark.parametrize("invalid_kind", ("nested_empty", "missing_finish", "invalid_finish"))
def test_diagnostics_require_an_effective_finished_inference(protocol, method, invalid_kind):
    body = deepcopy(EMPTY_ENVELOPES[protocol] if invalid_kind == "nested_empty" else VALID_BODIES[protocol])
    if invalid_kind != "nested_empty":
        invalid = None if invalid_kind == "missing_finish" else "not-a-finished-response"
        if protocol == "openai":
            body["choices"][0]["finish_reason"] = invalid
        elif protocol == "responses":
            body["status"] = invalid
        elif protocol == "anthropic":
            body["stop_reason"] = invalid
        elif protocol == "gemini":
            body["candidates"][0]["finishReason"] = invalid
        elif invalid_kind == "missing_finish":
            body["done"] = False
        else:
            body["done_reason"] = invalid

    async def scenario():
        provider = await provider_for(protocol, lambda _request: httpx.Response(200, json=body))
        try:
            with pytest.raises(ModelProviderError) as caught:
                await getattr(provider, method)()
            assert caught.value.code == "invalid_provider_response"
            assert provider._record_event.call_args.kwargs["error"] is caught.value
        finally:
            await close_client(provider)

    asyncio.run(scenario())


@pytest.mark.parametrize("protocol", PROTOCOLS)
@pytest.mark.parametrize("method", ("probe_vision", "check_connection"))
@pytest.mark.parametrize("result_kind", ("truncated", "refusal"))
def test_legitimate_token_limits_and_structured_refusals_are_protocol_responses(protocol, method, result_kind):
    body = TRUNCATED_BODIES[protocol] if result_kind == "truncated" else REFUSAL_BODIES[protocol]

    async def scenario():
        provider = await provider_for(protocol, lambda _request: httpx.Response(200, json=body))
        try:
            result = await getattr(provider, method)()
            if method == "probe_vision":
                assert result["status"] == "supported"
            assert "error" not in provider._record_event.call_args.kwargs
        finally:
            await close_client(provider)

    asyncio.run(scenario())


@pytest.mark.parametrize("protocol", PROTOCOLS)
def test_vision_rejection_is_classified_from_json_error_body(protocol):
    async def scenario():
        provider = await provider_for(protocol, lambda _request: httpx.Response(
            400, json={"error": {"message": "This model does not support image input"}},
        ))
        try:
            assert (await provider.probe_vision())["status"] == "unsupported"
        finally:
            await close_client(provider)

    asyncio.run(scenario())


@pytest.mark.parametrize("protocol", PROTOCOLS)
@pytest.mark.parametrize("status,message", (
    (401, "Image model authentication failed"),
    (429, "Image model rate limited"),
    (500, "Image model currently unsupported by the account pool"),
    (400, "Unsupported parameter: max_tokens for the image model"),
))
def test_other_provider_failures_do_not_claim_vision_is_unsupported(protocol, status, message):
    async def scenario():
        provider = await provider_for(protocol, lambda _request: httpx.Response(status, json={"error": {"message": message}}))
        try:
            with pytest.raises(ModelProviderError):
                await provider.probe_vision()
        finally:
            await close_client(provider)

    asyncio.run(scenario())


def test_auto_vision_probe_falls_back_after_invalid_native_response_and_updates_report():
    async def scenario():
        provider = build_model_provider(
            api_key=SYNTHETIC_KEY, model="claude-test", base_url=BASE_URL, protocol="auto",
        )
        clients = [item[1] for item in provider._providers]
        for candidate in clients:
            body = VALID_BODIES["openai"] if candidate.name == "openai" else {"message": "Gateway home"}
            await mock_client(candidate, lambda _request, body=body: httpx.Response(200, json=body))
        try:
            assert get_negotiated_model_protocol("claude-test", "auto", BASE_URL, SYNTHETIC_KEY) is None
            assert (await provider.probe_vision())["status"] == "supported"
            assert provider.name == "openai"
            assert get_effective_model_protocol("claude-test", "auto", BASE_URL, SYNTHETIC_KEY) == "openai"
            assert get_effective_model_protocol("claude-test", "anthropic", BASE_URL, SYNTHETIC_KEY) == "anthropic"
            report = infer_model_capabilities("claude-test", provider="anthropic", base_url=BASE_URL, protocol="auto")
            assert report["actual_protocol"] is None
            assert report["protocol_source"] == "predicted"
            apply_actual_protocol(report, provider, BASE_URL)
            assert report["provider"] == report["protocol"] == "openai"
            assert report["actual_protocol"] == "openai"
            assert report["protocol_source"] == "negotiated"
            assert "Chat Completions" in report["protocol_label"]
            assert report["streaming"]["status"] == report["tools"]["status"] == "unknown"
        finally:
            for candidate in clients:
                await close_client(candidate)

    asyncio.run(scenario())


def test_monitor_normalizes_gemini_root_and_keeps_old_official_openai_events():
    assert ("https://generativelanguage.googleapis.com/v1beta", "gemini") in _monitor_candidate_pairs(
        "gemini-test", "auto", "https://generativelanguage.googleapis.com",
    )
    pairs = _monitor_candidate_pairs("gpt-test", "auto", "https://api.openai.com/v1")
    assert ("https://api.openai.com/v1", "openai") in pairs
    assert ("", "openai") in pairs


def test_invalid_vision_responses_cannot_enter_the_successful_protocol_cache():
    async def scenario():
        provider = build_model_provider(
            api_key=SYNTHETIC_KEY, model="claude-test", base_url=BASE_URL, protocol="auto",
        )
        clients = [item[1] for item in provider._providers]
        for candidate in clients:
            await mock_client(candidate, lambda _request: httpx.Response(200, json={"message": "Gateway home"}))
        try:
            with pytest.raises(ModelProviderError):
                await provider.probe_vision()
            assert _SUCCESSFUL_PROTOCOLS == {}
        finally:
            for candidate in clients:
                await close_client(candidate)

    asyncio.run(scenario())

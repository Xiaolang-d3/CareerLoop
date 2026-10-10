import asyncio
from unittest.mock import Mock

import httpx
import pytest
from openai import AsyncOpenAI

from app.model_protocol import model_protocol_candidates
from app.models.auto_negotiating import clear_protocol_cache, get_negotiated_model_protocol
from app.models.base import ModelProviderError
from app.models.factory import build_model_provider
from app.models.validation import is_protocol_rejection


@pytest.mark.parametrize("message,status,expected", [
    ("模型 grok-4.7 不支持 chat completions 协议 (request id: test)", 400, True),
    ("This model does not support the chat completions endpoint", 400, True),
    ("Unsupported protocol: chat_completions", 400, True),
    ("chat completions is not supported", 422, True),
    ("This model does not support tools in chat completions", 400, False),
    ("Invalid temperature for chat completions", 400, False),
    ("模型不支持图片输入", 400, False),
    ("does not support chat completions", 401, False),
    ("does not support chat completions", 429, False),
    ("does not support chat completions", 500, False),
])
def test_explicit_protocol_rejection_only(message, status, expected):
    assert is_protocol_rejection(message, status) is expected


def test_explicit_protocol_and_local_provider_do_not_negotiate():
    assert model_protocol_candidates("grok-4.7", "auto", "https://gateway.test/v1") == ("openai", "responses")
    assert model_protocol_candidates("grok-4.7", "openai", "https://gateway.test/v1") == ("openai",)
    assert model_protocol_candidates("local", "auto", "http://localhost:11434") == ("ollama",)


@pytest.mark.parametrize("rejection,success", [
    ("模型 grok-4.7 不支持 chat completions 协议", True),
    ("Invalid temperature", False),
])
def test_health_check_negotiates_same_root_and_remembers_success(rejection, success):
    clear_protocol_cache()
    paths = []
    async def run():
        provider = build_model_provider(api_key="test-key", model="grok-4.7", base_url="https://gateway.test/v1")
        def handler(request):
            paths.append(request.url.path)
            assert request.url.host == "gateway.test"
            if request.url.path.endswith("chat/completions"):
                return httpx.Response(400, json={"error": {"message": rejection}})
            return httpx.Response(200, json={"id": "resp_test", "object": "response", "status": "completed", "model": "grok-4.7", "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "OK", "annotations": []}]}]})
        for _, candidate in provider._providers:
            await candidate._client.close()
            candidate._client = AsyncOpenAI(api_key="test-key", base_url="https://gateway.test/v1", max_retries=0, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
            candidate._record_event = Mock()
        try:
            if success:
                await provider.check_connection()
                await provider.check_connection()
                assert get_negotiated_model_protocol("grok-4.7", "auto", "https://gateway.test/v1", "test-key") == "responses"
            else:
                with pytest.raises(ModelProviderError) as error:
                    await provider.check_connection()
                assert error.value.code == "provider_error"
        finally:
            for _, candidate in provider._providers:
                await candidate._client.close()
    try:
        asyncio.run(run())
        assert paths == (["/v1/chat/completions", "/v1/responses", "/v1/responses"] if success else ["/v1/chat/completions"])
    finally:
        clear_protocol_cache()

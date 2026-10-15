import asyncio
import base64
import json
from io import BytesIO
from unittest.mock import Mock

import httpx
import pytest
from openai import AsyncOpenAI
from PIL import Image

from app.api.model_contracts import ConnectionCreateIn
from app.api.schemas import AgentSettingsIn
from app.domain import AgentMessage, ModelRequest
from app.model_connection import resolve_model_connection
from app.model_protocol import model_protocol_candidates, resolve_model_protocol
from app.models import ModelProviderError
from app.models.factory import build_model_provider
from app.models.openai_images import OpenAIImagesProvider
from app.models.litellm_router import route_target_for_connection


def png_base64():
    buffer = BytesIO()
    Image.new("RGB", (32, 16), "blue").save(buffer, "PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def image_request():
    return ModelRequest(messages=[AgentMessage(role="user", content="画一只猫")], image_generation=True,
                        parameters={"temperature": 0.7, "max_output_tokens": 100}, reasoning_effort="high")


async def call_with_transport(handler, *, streaming=False, request=None, diagnostic=False):
    provider = OpenAIImagesProvider(api_key="test-image-key", model="gpt-image-2", base_url="https://cf.api.fan")
    provider._record_event = Mock()
    provider._image_download_transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider._client = AsyncOpenAI(api_key="test-image-key", base_url=provider._base_url, http_client=client, max_retries=0)
        if diagnostic:
            await provider.check_connection()
            return await provider.probe_vision(), provider
        if streaming:
            return [event async for event in provider.stream(request or image_request())], provider
        return await provider.generate(request or image_request()), provider


@pytest.mark.parametrize("backend", ["native", "litellm"])
@pytest.mark.parametrize("protocol", ["auto", "images"])
def test_factory_routes_directly_to_images_for_both_backends(backend, protocol):
    provider = build_model_provider(api_key="test-image-key", model="gpt-image-2", base_url="https://cf.api.fan",
                                    protocol=protocol, backend=backend, price_per_million_input=1.0)
    assert isinstance(provider, OpenAIImagesProvider)
    assert provider.models_url == "https://cf.api.fan/v1/models"
    assert model_protocol_candidates("gpt-image-2", "auto", "https://cf.api.fan") == ("images",)
    assert resolve_model_protocol("gpt-image-2", "responses") == "responses"


def test_images_contract_and_root_normalization():
    values = dict(model_name="gpt-image-2", model_base_url="https://cf.api.fan", model_protocol="images", api_key="test-key")
    assert ConnectionCreateIn(**values).model_protocol == "images"
    assert AgentSettingsIn(**values, persona_role="general").model_protocol == "images"
    assert resolve_model_connection(values)["model_base_url"] == "https://cf.api.fan/v1"
    for root in ("https://cf.api.fan/v1/", "https://gateway.invalid/tenant/api/"):
        provider = OpenAIImagesProvider(api_key="test-key", model="gpt-image-2", base_url=root)
        assert provider._base_url == root.rstrip("/")


@pytest.mark.parametrize("streaming", [False, True])
def test_generation_uses_single_nonstreaming_images_post_and_keeps_bytes_private(streaming):
    requests = []
    encoded = png_base64()
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"created": 1, "data": [{"b64_json": encoded, "revised_prompt": "a cat"}],
                                        "usage": {"input_tokens": 2, "output_tokens": 3, "total_tokens": 5}})
    result, provider = asyncio.run(call_with_transport(handler, streaming=streaming))
    if streaming:
        assert [event.type for event in result] == ["completed"]
        assert encoded not in str([event.model_dump() for event in result])
        result = result[0].response
    assert len(requests) == 1 and requests[0].method == "POST"
    assert str(requests[0].url) == "https://cf.api.fan/v1/images/generations"
    assert json.loads(requests[0].content) == {"model": "gpt-image-2", "prompt": "画一只猫", "n": 1}
    assert result.images[0].base64_data.get_secret_value() == encoded
    assert encoded not in result.model_dump_json() and encoded not in repr(result)
    assert result.usage.total_tokens == 5
    assert provider._record_event.call_args.kwargs["total_tokens"] == 5
    assert encoded not in str(provider._record_event.call_args)


def test_gateway_rejecting_response_format_accepts_minimal_request():
    requests = []
    def handler(request):
        requests.append(request)
        if 'response_format' in json.loads(request.content):
            return httpx.Response(400, json={"error": {"message": "Unknown parameter: 'response_format'."}})
        return httpx.Response(200, json={"data": [{"b64_json": png_base64()}]})
    result, _ = asyncio.run(call_with_transport(handler))
    assert len(requests) == 1 and len(result.images) == 1


def test_packy_url_output_is_downloaded_once_without_api_credential():
    requests = []
    url = 'https://external-resources.packyapi.ai/file_download/test-image?signature=test'
    encoded = png_base64()
    def handler(request):
        requests.append(request)
        if request.method == 'POST':
            return httpx.Response(200, json={"data": [{"url": url}]})
        assert str(request.url) == url
        assert 'authorization' not in request.headers and 'cookie' not in request.headers
        return httpx.Response(200, content=base64.b64decode(encoded), headers={"content-type": "image/png"})
    result, _ = asyncio.run(call_with_transport(handler, streaming=True))
    assert [r.method for r in requests] == ['POST', 'GET']
    assert result[0].response.images[0].base64_data.get_secret_value() == encoded
    assert url not in str(result[0].model_dump())


@pytest.mark.parametrize('url', ['http://external-resources.packyapi.ai/file_download/test',
    'https://localhost/file_download/test', 'https://127.0.0.1/file_download/test',
    'https://external-resources.packyapi.ai.evil.test/file_download/test',
    'https://user:pass@external-resources.packyapi.ai/file_download/test',
    'https://external-resources.packyapi.ai:1234/file_download/test',
    'https://external-resources.packyapi.ai/unexpected-path'])
def test_url_output_rejects_unapproved_downloads_without_another_request(url):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"url": url}]})
    with pytest.raises(ModelProviderError) as caught:
        asyncio.run(call_with_transport(handler))
    assert caught.value.code == 'invalid_image_output' and len(requests) == 1


@pytest.mark.parametrize('failure', ['redirect', 'timeout', 'oversize-header', 'oversize-body', 'empty'])
def test_download_failure_does_not_regenerate_or_follow_redirects(failure):
    requests = []
    def handler(request):
        requests.append(request)
        if request.method == 'POST':
            return httpx.Response(200, json={"data": [{"url": 'https://external-resources.packyapi.ai/file_download/test'}]})
        if failure == 'redirect':
            return httpx.Response(302, headers={'location': 'https://127.0.0.1/private'})
        if failure == 'timeout':
            raise httpx.ReadTimeout('timeout', request=request)
        if failure == 'oversize-header':
            return httpx.Response(200, headers={'content-length': '20000001'})
        return httpx.Response(200, content=b'x' * 20_000_001 if failure == 'oversize-body' else b'')
    with pytest.raises(ModelProviderError) as caught:
        asyncio.run(call_with_transport(handler))
    assert not caught.value.retryable
    assert [r.method for r in requests] == ['POST', 'GET']


@pytest.mark.parametrize("failure", ["timeout", "server", "html", "missing", "url"])
def test_generation_failures_never_retry_or_switch_endpoints(failure):
    calls = []
    def handler(request):
        calls.append(str(request.url))
        if failure == "timeout":
            raise httpx.ReadTimeout("timeout", request=request)
        if failure == "server":
            return httpx.Response(503, json={"error": {"message": "unavailable"}})
        if failure == "html":
            return httpx.Response(200, text="<html>Cloudflare</html>", headers={"content-type": "text/html"})
        return httpx.Response(200, json={"data": [] if failure == "missing" else [{"url": "https://images.invalid/cat.png"}]})
    with pytest.raises(ModelProviderError) as caught:
        asyncio.run(call_with_transport(handler, streaming=True))
    assert not caught.value.retryable
    assert calls == ["https://cf.api.fan/v1/images/generations"]


def test_diagnostics_only_read_catalog_and_do_not_generate():
    requests = []
    def handler(request):
        requests.append((request.method, str(request.url)))
        return httpx.Response(200, json={"data": [{"id": "gpt-image-2"}]})
    vision, _ = asyncio.run(call_with_transport(handler, diagnostic=True))
    assert requests == [("GET", "https://cf.api.fan/v1/models")]
    assert vision["status"] == "unsupported"


@pytest.mark.parametrize("input_request", [ModelRequest(messages=[]),
    ModelRequest(messages=[AgentMessage(role="user", payload={"image_urls": ["data:image/png;base64,test"]})], image_generation=True)])
def test_text_and_edit_requests_do_not_generate(input_request):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(500)
    with pytest.raises(ModelProviderError):
        asyncio.run(call_with_transport(handler, request=input_request))
    assert not calls


def test_image_models_cannot_be_completion_fallbacks():
    with pytest.raises(ValueError, match="聊天备用"):
        route_target_for_connection({"resolved_model_protocol": "images"}, timeout_seconds=60)

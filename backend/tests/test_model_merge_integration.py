"""Contracts shared by the chat-assets and LiteLLM model-layer branches."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.domain import AgentMessage, ModelRequest, ModelResponse, ModelStreamEvent
from app.models.configured import ConfiguredModelProvider
from app.models.litellm_provider import LiteLLMProvider
from app.models.litellm_router import RoutedModelProvider


def test_profile_output_ceiling_and_reasoning_effort_apply_together():
    native = SimpleNamespace(generate=AsyncMock(return_value=ModelResponse(content="ok")))
    provider = ConfiguredModelProvider(native, {"max_output_tokens": 128}, "high")
    request = ModelRequest(messages=[AgentMessage(role="user", content="hi")], parameters={"max_output_tokens": 512})
    asyncio.run(provider.generate(request))
    applied = native.generate.await_args.args[0]
    assert applied.parameters["max_output_tokens"] == 128
    assert applied.reasoning_effort == "high"


@pytest.mark.parametrize("routed", [False, True])
def test_images_preserve_native_output_and_never_enter_completion_router(routed):
    response = ModelResponse(output_blocks=[{"type": "image", "asset_id": "fixture-image"}])
    progress = ModelStreamEvent(type="image_progress")
    completed = ModelStreamEvent(type="completed", response=response)
    requests = []

    async def native_stream(request):
        requests.append(request)
        yield progress
        yield completed

    native = SimpleNamespace(generate=AsyncMock(return_value=response), stream=native_stream)
    primary = LiteLLMProvider("fixture-key", "grok-4.7", "https://example.invalid/v1", protocol="responses")
    primary._native = native
    primary._aresponses = AsyncMock(side_effect=AssertionError("Image request must not enter the SDK retry loop"))
    provider = primary
    if routed:
        provider = RoutedModelProvider(primary=primary, primary_identity={}, primary_parameters={}, primary_reasoning_effort=None, fallbacks={}, policy={})
        provider._router = Mock(side_effect=AssertionError("Image request must not enter the completion router"))
    request = ModelRequest(messages=[AgentMessage(role="user", content="draw")], image_generation=True)
    assert asyncio.run(provider.generate(request)) is response

    async def collect():
        return [event async for event in provider.stream(request)]

    assert asyncio.run(collect()) == [progress, completed]
    native.generate.assert_awaited_once_with(request)
    assert requests == [request]
    primary._aresponses.assert_not_awaited()

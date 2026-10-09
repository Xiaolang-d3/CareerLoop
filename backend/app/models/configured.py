"""Bind validated profile parameters to an otherwise reusable protocol adapter."""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from ..domain import ModelRequest, ModelResponse, ModelStreamEvent


class ConfiguredModelProvider:
    def __init__(self, provider: Any, parameters: dict[str, float | int]) -> None:
        self._provider = provider
        self._parameters = dict(parameters)

    @property
    def name(self) -> str:
        return self._provider.name

    @property
    def models_url(self) -> str:
        return self._provider.models_url

    def _request(self, request: ModelRequest) -> ModelRequest:
        return request.model_copy(update={"parameters": {**self._parameters, **request.parameters}})

    async def generate(self, request: ModelRequest) -> ModelResponse:
        return await self._provider.generate(self._request(request))

    async def stream(self, request: ModelRequest) -> AsyncIterator[ModelStreamEvent]:
        async for event in self._provider.stream(self._request(request)):
            yield event

    async def list_models(self) -> list[str]:
        return await self._provider.list_models()

    async def check_connection(self) -> None:
        await self._provider.check_connection()

    async def probe_vision(self) -> dict[str, str]:
        return await self._provider.probe_vision()


def configure_model_provider(provider: Any, parameters: dict[str, float | int]) -> Any:
    return ConfiguredModelProvider(provider, parameters) if parameters else provider

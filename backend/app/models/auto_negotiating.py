from __future__ import annotations

from collections.abc import AsyncIterator
from hashlib import sha256
from typing import Any

from ..domain import ModelRequest, ModelResponse, ModelStreamEvent
from .base import ModelProviderError


FALLBACK_ERROR_CODES = frozenset({"route_not_found", "invalid_provider_response"})
_SUCCESSFUL_PROTOCOLS: dict[str, str] = {}


def protocol_cache_key(base_url: str | None, model: str, api_key: str) -> str:
    fingerprint = sha256(api_key.encode("utf-8")).hexdigest()[:16] if api_key else "no-key"
    return f"{(base_url or '').strip().rstrip('/')}|{model.strip()}|{fingerprint}"


def clear_protocol_cache() -> None:
    _SUCCESSFUL_PROTOCOLS.clear()


class AutoNegotiatingModelProvider:
    """Try a native protocol first and fall back only for proven route mismatches."""

    def __init__(self, providers: list[tuple[str, Any]], cache_key: str) -> None:
        if not providers:
            raise ValueError("自动协议匹配至少需要一个 Provider")
        cached = _SUCCESSFUL_PROTOCOLS.get(cache_key)
        if cached:
            providers.sort(key=lambda item: item[0] != cached)
        self._providers = providers
        self._cache_key = cache_key
        self._active_index = 0

    @property
    def name(self) -> str:
        return str(self._providers[self._active_index][0])

    @property
    def models_url(self) -> str:
        return str(self._active_provider.models_url)

    @property
    def _active_provider(self) -> Any:
        return self._providers[self._active_index][1]

    def _remember(self, index: int) -> None:
        self._active_index = index
        _SUCCESSFUL_PROTOCOLS[self._cache_key] = self._providers[index][0]

    def _candidate_indexes(self) -> list[int]:
        return [self._active_index, *[index for index in range(len(self._providers)) if index != self._active_index]]

    @staticmethod
    def _can_fallback(error: ModelProviderError, position: int, candidate_count: int) -> bool:
        return error.code in FALLBACK_ERROR_CODES and position + 1 < candidate_count

    async def _call(self, method: str, *args: Any) -> Any:
        candidates = self._candidate_indexes()
        for position, index in enumerate(candidates):
            provider = self._providers[index][1]
            try:
                result = await getattr(provider, method)(*args)
            except ModelProviderError as error:
                if not self._can_fallback(error, position, len(candidates)):
                    raise
                continue
            self._remember(index)
            return result
        raise RuntimeError("自动协议匹配没有可用候选")

    async def generate(self, request: ModelRequest) -> ModelResponse:
        return await self._call("generate", request)

    async def check_connection(self) -> None:
        await self._call("check_connection")

    async def list_models(self) -> list[str]:
        return await self._call("list_models")

    async def probe_vision(self) -> dict[str, str]:
        return await self._call("probe_vision")

    async def stream(self, request: ModelRequest) -> AsyncIterator[ModelStreamEvent]:
        candidates = self._candidate_indexes()
        for position, index in enumerate(candidates):
            provider = self._providers[index][1]
            emitted = False
            try:
                async for event in provider.stream(request):
                    emitted = True
                    yield event
            except ModelProviderError as error:
                if emitted or not self._can_fallback(error, position, len(candidates)):
                    raise
                continue
            self._remember(index)
            return
        raise RuntimeError("自动协议匹配没有可用候选")

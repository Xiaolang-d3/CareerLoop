from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from hashlib import sha256
from typing import Any

from ..domain import ModelRequest, ModelResponse, ModelStreamEvent
from ..model_protocol import normalize_model_protocol, resolve_model_protocol
from .base import ModelProviderError


FALLBACK_ERROR_CODES = frozenset({"route_not_found", "invalid_provider_response", "protocol_unsupported"})
_SUCCESSFUL_PROTOCOLS: dict[str, str] = {}


def protocol_cache_key(base_url: str | None, model: str, api_key: str) -> str:
    fingerprint = sha256(api_key.encode("utf-8")).hexdigest()[:16] if api_key else "no-key"
    return f"{(base_url or '').strip().rstrip('/')}|{model.strip()}|{fingerprint}"


def clear_protocol_cache() -> None:
    _SUCCESSFUL_PROTOCOLS.clear()


def get_effective_model_protocol(
    model_name: str,
    configured: str = "auto",
    base_url: str = "",
    api_key: str = "",
) -> str:
    """Return a negotiated protocol, or the prediction before negotiation."""
    return get_negotiated_model_protocol(model_name, configured, base_url, api_key) or resolve_model_protocol(model_name, configured, base_url)


def get_negotiated_model_protocol(
    model_name: str,
    configured: str = "auto",
    base_url: str = "",
    api_key: str = "",
) -> str | None:
    """Return only a previously successful auto negotiation, without prediction."""
    if normalize_model_protocol(configured) != "auto":
        return None
    return _SUCCESSFUL_PROTOCOLS.get(protocol_cache_key(base_url, model_name, api_key))


class AutoNegotiatingModelProvider:
    """Try a native protocol first and fall back only for proven route mismatches."""

    def __init__(
        self,
        providers: list[tuple[str, Any]],
        cache_key: str,
        *,
        preferred: str | None = None,
        on_protocol_detected: Callable[[str], None] | None = None,
    ) -> None:
        if not providers:
            raise ValueError("自动协议匹配至少需要一个 Provider")
        names = {name for name, _ in providers}
        # A durable detection (persisted per connection) seeds the in-memory
        # cache so a restarted backend starts on the protocol that worked.
        if preferred in names and cache_key not in _SUCCESSFUL_PROTOCOLS:
            _SUCCESSFUL_PROTOCOLS[cache_key] = str(preferred)
        cached = _SUCCESSFUL_PROTOCOLS.get(cache_key)
        if cached:
            providers.sort(key=lambda item: item[0] != cached)
        self._providers = providers
        self._cache_key = cache_key
        self._active_index = 0
        self._persisted = preferred if preferred in names else None
        self._on_protocol_detected = on_protocol_detected

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
        protocol = str(self._providers[index][0])
        _SUCCESSFUL_PROTOCOLS[self._cache_key] = protocol
        if self._on_protocol_detected is not None and protocol != self._persisted:
            try:
                self._on_protocol_detected(protocol)
                self._persisted = protocol
            except Exception:
                # Persisting the detection is an optimization; never fail a call.
                pass

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

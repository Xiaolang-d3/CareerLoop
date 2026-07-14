from __future__ import annotations

from typing import Protocol

from ..domain import ModelRequest, ModelResponse
from ..registry import NamedRegistry


class ModelProviderError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class ModelProvider(Protocol):
    name: str

    async def generate(self, request: ModelRequest) -> ModelResponse:
        ...


class ModelProviderRegistry(NamedRegistry[ModelProvider]):
    def __init__(self) -> None:
        super().__init__("模型提供商")

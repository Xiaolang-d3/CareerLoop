"""Central size governance for tool results, independent of any business domain."""
from __future__ import annotations

from typing import Any

from ..domain import ToolResult

MAX_RESULT_MESSAGE_CHARS = 4000
MAX_RESULT_STRING_CHARS = 3000
MAX_RESULT_ITEMS = 50
MAX_RESULT_DATA_CHARS = 32000
MAX_RESULT_DEPTH = 6

_TRUNCATION_SUFFIX = "…（内容过长，已截断）"
_STRING_SUFFIX = "…（已截断）"
_DEPTH_MARKER = "…（层级过深，已截断）"

_MARKERS = frozenset({_TRUNCATION_SUFFIX, _STRING_SUFFIX, _DEPTH_MARKER})
_PROTECTED_KEYS = frozenset({"url", "source_url", "href"})


class _Budget:
    __slots__ = ("chars", "truncated")

    def __init__(self, chars: int) -> None:
        self.chars = chars
        self.truncated = False


def _bounded_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: max(limit - len(_TRUNCATION_SUFFIX), 0)] + _TRUNCATION_SUFFIX


def _govern_string(text: str, budget: _Budget) -> str:
    if text in _MARKERS:
        budget.truncated = True
        return text
    if budget.chars <= 0:
        budget.truncated = True
        return _STRING_SUFFIX
    limit = min(MAX_RESULT_STRING_CHARS, budget.chars)
    if len(text) > limit:
        budget.truncated = True
        if limit <= len(_STRING_SUFFIX):
            budget.chars = 0
            return _STRING_SUFFIX
        cut = text[: limit - len(_STRING_SUFFIX)] + _STRING_SUFFIX
        budget.chars -= len(cut)
        return cut
    budget.chars -= len(text)
    return text


def _govern_value(value: Any, depth: int, budget: _Budget) -> Any:
    if isinstance(value, str):
        return _govern_string(value, budget)
    if isinstance(value, dict):
        if depth >= MAX_RESULT_DEPTH:
            if not value:
                return {}
            budget.truncated = True
            return _DEPTH_MARKER
        if len(value) > MAX_RESULT_ITEMS:
            budget.truncated = True
        governed: dict[Any, Any] = {}
        for key, item in list(value.items())[:MAX_RESULT_ITEMS]:
            if key in _PROTECTED_KEYS and isinstance(item, str):
                governed[key] = _bounded_text(item, MAX_RESULT_STRING_CHARS)
            else:
                governed[key] = _govern_value(item, depth + 1, budget)
        return governed
    if isinstance(value, (list, tuple)):
        if depth >= MAX_RESULT_DEPTH:
            if not value:
                return []
            budget.truncated = True
            return _DEPTH_MARKER
        if len(value) > MAX_RESULT_ITEMS:
            budget.truncated = True
        return [_govern_value(item, depth + 1, budget) for item in value[:MAX_RESULT_ITEMS]]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return _govern_string(str(value), budget)


def govern_tool_result(result: ToolResult) -> ToolResult:
    """Bound message, error and data sizes; deterministic and idempotent."""
    budget = _Budget(MAX_RESULT_DATA_CHARS)
    data = _govern_value(result.data, 0, budget)
    if not isinstance(data, dict):
        data = {"data": data}
    truncated = budget.truncated

    message = _bounded_text(result.message, MAX_RESULT_MESSAGE_CHARS)
    truncated = truncated or message != result.message

    error = result.error
    if error is not None:
        bounded = _bounded_text(error.message, MAX_RESULT_MESSAGE_CHARS)
        if bounded != error.message:
            error = error.model_copy(update={"message": bounded})
            truncated = True

    if truncated:
        if len(data) >= MAX_RESULT_ITEMS:
            data = {**dict(list(data.items())[: MAX_RESULT_ITEMS - 1]), "truncated": True}
        else:
            data = {**data, "truncated": True}
    return result.model_copy(update={"message": message, "data": data, "error": error})

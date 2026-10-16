"""Central size governance for tool results, independent of any business domain."""
from __future__ import annotations

import json
from itertools import islice
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

_PROTECTED_KEYS = frozenset({"url", "source_url", "href"})
_OMITTED = object()


def _json_size(value: Any) -> int:
    # Match the tool-message serialization used by the model adapters.
    return len(json.dumps(value, ensure_ascii=False))


def _bounded_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: max(limit - len(_TRUNCATION_SUFFIX), 0)] + _TRUNCATION_SUFFIX


def _measured_size(value: Any, depth: int, limit: int) -> int | None:
    """Validate limits while counting JSON characters; stop as soon as it cannot fit."""
    if limit < 2:
        return None
    if isinstance(value, str):
        if len(value) > MAX_RESULT_STRING_CHARS:
            return None
        size = _json_size(value)
    elif isinstance(value, (dict, list, tuple)):
        if len(value) > MAX_RESULT_ITEMS or (value and depth >= MAX_RESULT_DEPTH):
            return None
        size = 2
        entries = value.items() if isinstance(value, dict) else enumerate(value)
        for index, (key, item) in enumerate(entries):
            overhead = 2 if index else 0
            if isinstance(value, dict):
                if not isinstance(key, str) or len(key) > MAX_RESULT_STRING_CHARS:
                    return None
                overhead += _json_size(key) + 2
            child_size = _measured_size(item, depth + 1, limit - size - overhead)
            if child_size is None:
                return None
            size += overhead + child_size
    elif value is None or isinstance(value, (bool, int, float)):
        try:
            size = _json_size(value)
        except ValueError:
            return None
    else:
        return None
    return size if size <= limit else None


def _govern_string(text: str, limit: int) -> tuple[Any, int]:
    if _json_size(_STRING_SUFFIX) > limit:
        return _OMITTED, 0
    low = 0
    high = min(len(text), MAX_RESULT_STRING_CHARS - len(_STRING_SUFFIX))
    while low < high:
        middle = (low + high + 1) // 2
        if _json_size(text[:middle] + _STRING_SUFFIX) <= limit:
            low = middle
        else:
            high = middle - 1
    bounded = text[:low] + _STRING_SUFFIX
    return bounded, _json_size(bounded)


def _govern_value(value: Any, depth: int, limit: int) -> tuple[Any, int]:
    size = _measured_size(value, depth, limit)
    if size is not None:
        return value, size
    if limit < 2:
        return _OMITTED, 0
    if isinstance(value, (dict, list, tuple)):
        if depth >= MAX_RESULT_DEPTH:
            return _govern_value(_DEPTH_MARKER, depth, limit)
        if isinstance(value, dict):
            entries = [(str(key), item) for key, item in islice(value.items(), MAX_RESULT_ITEMS)]
            entries = [(key, item) for key, item in entries if len(key) <= MAX_RESULT_STRING_CHARS]
            protected = [(key, item) for key, item in entries if key in _PROTECTED_KEYS and isinstance(item, str)]
            ordinary = [(key, item) for key, item in entries if not (key in _PROTECTED_KEYS and isinstance(item, str))]
            governed: dict[str, Any] = {}
            size = 2
            # Keep reference identities whole, but charge their full JSON cost.
            for key, item in protected:
                if len(item) > MAX_RESULT_STRING_CHARS:
                    continue
                cost = _json_size(key) + 2 + _json_size(item) + (2 if governed else 0)
                if size + cost <= limit:
                    governed[key] = item
                    size += cost
            for index, (key, item) in enumerate(ordinary):
                overhead = _json_size(key) + 2 + (2 if governed else 0)
                share = (limit - size) // (len(ordinary) - index) - overhead
                bounded, child_size = _govern_value(item, depth + 1, share)
                if bounded is not _OMITTED:
                    governed[key] = bounded
                    size += overhead + child_size
            return {key: governed[key] for key, _ in entries if key in governed}, size
        items = value[:MAX_RESULT_ITEMS]
        governed_items: list[Any] = []
        size = 2
        for index, item in enumerate(items):
            overhead = 2 if governed_items else 0
            share = (limit - size) // (len(items) - index) - overhead
            bounded, child_size = _govern_value(item, depth + 1, share)
            if bounded is not _OMITTED:
                governed_items.append(bounded)
                size += overhead + child_size
        return governed_items, size
    if value is None or isinstance(value, (bool, int, float)):
        return _OMITTED, 0
    return _govern_string(value if isinstance(value, str) else str(value), limit)


def govern_tool_result(result: ToolResult) -> ToolResult:
    """Bound message, error and data sizes; deterministic and idempotent."""
    message = _bounded_text(result.message, MAX_RESULT_MESSAGE_CHARS)
    error = result.error
    if error is not None:
        bounded = _bounded_text(error.message, MAX_RESULT_MESSAGE_CHARS)
        if bounded != error.message:
            error = error.model_copy(update={"message": bounded})

    if (
        message == result.message
        and error == result.error
        and _measured_size(result.data, 0, MAX_RESULT_DATA_CHARS) is not None
    ):
        return result

    # Reserve space and one top-level key for the truncation marker itself.
    entries = ((key, item) for key, item in result.data.items() if key != "truncated")
    data = dict(islice(entries, MAX_RESULT_ITEMS - 1))
    data, _ = _govern_value(data, 0, MAX_RESULT_DATA_CHARS - _json_size({"truncated": True}))
    data = {**data, "truncated": True}
    return result.model_copy(update={"message": message, "data": data, "error": error})

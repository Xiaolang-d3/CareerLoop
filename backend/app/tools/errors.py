"""Tool validation errors, independent of any business domain."""
from __future__ import annotations

import functools
from typing import Any

from pydantic import ValidationError

from ..domain import ToolError, ToolResult

MAX_VALIDATION_ERRORS = 5
MAX_VALIDATION_SUMMARY_LENGTH = 300


def _compact(text: str) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) > MAX_VALIDATION_SUMMARY_LENGTH:
        return collapsed[: MAX_VALIDATION_SUMMARY_LENGTH - 1] + "…"
    return collapsed


def describe_validation_error(error: Exception) -> str:
    """Compact single-line field summary for logs and model self-correction."""
    if not isinstance(error, ValidationError):
        return _compact(str(error)) or "参数不合法"
    parts: list[str] = []
    for item in error.errors()[:MAX_VALIDATION_ERRORS]:
        location = ".".join(str(part) for part in item.get("loc") or ()) or "arguments"
        message = _compact(str(item.get("msg") or ""))
        parts.append(f"{location}: {message}" if message else location)
    return _compact("；".join(parts)) or "参数不合法"


def invalid_arguments(message: str, error: Exception) -> ToolResult:
    return ToolResult(
        ok=False,
        status="failed",
        message=message,
        error=ToolError(code="invalid_arguments", message=describe_validation_error(error)),
    )


def tool_error_boundary(message: str):
    def decorator(execute):
        @functools.wraps(execute)
        async def wrapper(self, arguments: dict[str, Any], context) -> ToolResult:
            try:
                return await execute(self, arguments, context)
            except (ValidationError, ValueError) as exc:
                return invalid_arguments(message, exc)
        return wrapper
    return decorator

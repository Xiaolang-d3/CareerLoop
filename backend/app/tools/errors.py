"""Tool validation errors, independent of any business domain."""
from __future__ import annotations

import functools
from typing import Any

from pydantic import ValidationError

from ..domain import ToolError, ToolResult


def invalid_arguments(message: str, error: Exception) -> ToolResult:
    return ToolResult(
        ok=False,
        status="failed",
        message=message,
        error=ToolError(code="invalid_arguments", message=str(error)),
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

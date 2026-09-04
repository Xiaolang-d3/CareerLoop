from __future__ import annotations

import asyncio
from time import perf_counter

from ..domain import ToolCall, ToolError, ToolResult
from ..observability.tool_call_audit import record_tool_call_event
from ..tools import ToolContext, ToolRegistry


class ToolExecutor:
    """One execution boundary for timeout, normalization and audit."""

    def __init__(self, tools: ToolRegistry, default_timeout_seconds: float) -> None:
        self._tools = tools
        self._default_timeout_seconds = default_timeout_seconds

    async def execute(
        self,
        tool_call: ToolCall,
        context: ToolContext,
        *,
        round_number: int,
        conversation_id: int | None,
    ) -> ToolResult:
        started_at = perf_counter()
        timeout = (
            self._tools.spec(tool_call.name).timeout_seconds
            or self._default_timeout_seconds
        )
        try:
            handler = self._tools.get(tool_call.name)
            result = await asyncio.wait_for(
                handler.execute(tool_call.arguments, context),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            message = f"工具 {tool_call.name} 执行超时"
            result = ToolResult(
                ok=False,
                status="failed",
                data={"status": "failed", "error": "timeout"},
                message=message,
                error=ToolError(code="tool_timeout", message=message, retryable=True),
            )
        except Exception as exc:
            message = f"工具执行失败：{exc}"
            result = ToolResult(
                ok=False,
                status="failed",
                data={"status": "failed", "error": str(exc)},
                message=message,
                error=ToolError(code="tool_execution_failed", message=message),
            )

        self._record(
            conversation_id=conversation_id,
            round_number=round_number,
            tool_call=tool_call,
            result=result,
            started_at=started_at,
        )
        return result

    @staticmethod
    def _record(
        *,
        conversation_id: int | None,
        round_number: int,
        tool_call: ToolCall,
        result: ToolResult,
        started_at: float,
    ) -> None:
        try:
            record_tool_call_event(
                conversation_id=conversation_id,
                round_number=round_number,
                tool_call_id=tool_call.id,
                tool_name=tool_call.name,
                status=result.status,
                latency_ms=round((perf_counter() - started_at) * 1000),
                error_code=result.error.code if result.error else "",
            )
        except Exception:
            # Auditing is best-effort and must never break tool execution.
            pass

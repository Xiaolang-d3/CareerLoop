from __future__ import annotations

from ..domain import (
    AgentMessage,
    AgentRunResult,
    ModelRequest,
    ToolError,
    ToolEvent,
)
from ..models import ModelProviderError, ModelProviderRegistry
from ..tools import ToolContext, ToolRegistry


class AgentRuntime:
    def __init__(
        self,
        models: ModelProviderRegistry,
        tools: ToolRegistry,
        model_provider: str,
        platform_name: str,
        max_tool_rounds: int,
    ) -> None:
        self._models = models
        self._tools = tools
        self._model_provider = model_provider
        self._platform_name = platform_name
        self._max_tool_rounds = max_tool_rounds

    async def run(self, user_content: str, platform_name: str | None = None) -> AgentRunResult:
        provider = self._models.get(self._model_provider)
        selected_platform = platform_name or self._platform_name
        messages = [AgentMessage(role="user", content=user_content)]
        events: list[ToolEvent] = []

        for round_number in range(1, self._max_tool_rounds + 1):
            try:
                response = await provider.generate(
                    ModelRequest(messages=messages, tools=self._tools.definitions())
                )
            except ModelProviderError as exc:
                events.append(
                    ToolEvent(
                        round=round_number,
                        tool_call_id=f"model-round-{round_number}",
                        tool_name="model_provider",
                        status="failed",
                        message=str(exc),
                        data={"code": exc.code, "retryable": exc.retryable},
                    )
                )
                return AgentRunResult(
                    content=f"模型服务不可用：{exc}。系统没有切换到备用模型，请处理后重试。",
                    provider=self._model_provider,
                    platform=selected_platform,
                    rounds=round_number,
                    status="failed",
                    error=ToolError(code=exc.code, message=str(exc), retryable=exc.retryable),
                    events=events,
                )
            except Exception:
                events.append(
                    ToolEvent(
                        round=round_number,
                        tool_call_id=f"model-round-{round_number}",
                        tool_name="model_provider",
                        status="failed",
                        message="模型服务发生未知异常",
                        data={"code": "unknown_model_error", "retryable": False},
                    )
                )
                return AgentRunResult(
                    content="模型服务发生未知异常。系统没有切换到备用模型，请检查服务日志后重试。",
                    provider=self._model_provider,
                    platform=selected_platform,
                    rounds=round_number,
                    status="failed",
                    error=ToolError(
                        code="unknown_model_error",
                        message="模型服务发生未知异常",
                    ),
                    events=events,
                )
            if response.content and not response.tool_calls:
                return AgentRunResult(
                    content=response.content,
                    provider=self._model_provider,
                    platform=selected_platform,
                    rounds=round_number,
                    events=events,
                )

            if not response.tool_calls:
                return AgentRunResult(
                    content="模型没有返回可执行工具或最终回答。",
                    provider=self._model_provider,
                    platform=selected_platform,
                    rounds=round_number,
                    events=events,
                )

            messages.append(
                AgentMessage(
                    role="assistant",
                    content=response.content,
                    payload={
                        "tool_calls": [call.model_dump(mode="json") for call in response.tool_calls]
                    },
                )
            )
            for tool_call in response.tool_calls:
                try:
                    handler = self._tools.get(tool_call.name)
                    result = await handler.execute(
                        tool_call.arguments,
                        ToolContext(platform_name=selected_platform),
                    )
                except Exception as exc:
                    result_data = {"status": "failed", "error": str(exc)}
                    events.append(
                        ToolEvent(
                            round=round_number,
                            tool_call_id=tool_call.id,
                            tool_name=tool_call.name,
                            status="failed",
                            message=f"工具执行失败：{exc}",
                            data=result_data,
                        )
                    )
                    messages.append(
                        AgentMessage(
                            role="tool",
                            tool_call_id=tool_call.id,
                            content=f"工具执行失败：{exc}",
                            payload=result_data,
                        )
                    )
                    continue

                events.append(
                    ToolEvent(
                        round=round_number,
                        tool_call_id=tool_call.id,
                        tool_name=tool_call.name,
                        status=result.status,
                        message=result.message,
                        data=result.data,
                    )
                )
                messages.append(
                    AgentMessage(
                        role="tool",
                        tool_call_id=tool_call.id,
                        content=result.message,
                        payload={
                            "status": result.status,
                            "tool_name": tool_call.name,
                            **result.data,
                            "error": result.error.model_dump(mode="json") if result.error else None,
                        },
                    )
                )

        return AgentRunResult(
            content=f"Agent 已达到最大工具调用轮数（{self._max_tool_rounds}），本次任务已安全停止。",
            provider=self._model_provider,
            platform=selected_platform,
            rounds=self._max_tool_rounds,
            status="failed",
            error=ToolError(
                code="round_limit_reached",
                message="Agent 已达到最大工具调用轮数",
            ),
            events=events,
        )

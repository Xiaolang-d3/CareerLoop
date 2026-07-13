from __future__ import annotations

from ..domain import (
    AgentMessage,
    AgentRunResult,
    ModelRequest,
    ToolEvent,
)
from ..models import ModelProviderRegistry
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

    async def run(self, user_content: str) -> AgentRunResult:
        provider = self._models.get(self._model_provider)
        messages = [AgentMessage(role="user", content=user_content)]
        events: list[ToolEvent] = []

        for round_number in range(1, self._max_tool_rounds + 1):
            response = await provider.generate(
                ModelRequest(messages=messages, tools=self._tools.definitions())
            )
            if response.content and not response.tool_calls:
                return AgentRunResult(
                    content=response.content,
                    provider=self._model_provider,
                    platform=self._platform_name,
                    rounds=round_number,
                    events=events,
                )

            if not response.tool_calls:
                return AgentRunResult(
                    content="模型没有返回可执行工具或最终回答。",
                    provider=self._model_provider,
                    platform=self._platform_name,
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
                        ToolContext(platform_name=self._platform_name),
                    )
                except Exception as exc:
                    result_data = {"error": str(exc)}
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
                        payload=result.data,
                    )
                )

        return AgentRunResult(
            content=f"Agent 已达到最大工具调用轮数（{self._max_tool_rounds}），本次任务已安全停止。",
            provider=self._model_provider,
            platform=self._platform_name,
            rounds=self._max_tool_rounds,
            events=events,
        )

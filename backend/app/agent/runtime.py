from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable

from ..domain import (
    AgentMessage,
    AgentRunResult,
    AgentStreamEvent,
    ModelRequest,
    ModelResponse,
    ToolError,
    ToolEvent,
)
from ..models import ModelProviderError, ModelProviderRegistry
from ..tools import ToolContext, ToolRegistry
from .orchestration import parse_plan, planner_prompt, route_summary, route_task


StreamCallback = Callable[[AgentStreamEvent], Awaitable[None]]


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

    async def run(
        self,
        user_content: str,
        platform_name: str | None = None,
        history: list[AgentMessage] | None = None,
        conversation_id: int | None = None,
        task_id: int | None = None,
        event_callback: StreamCallback | None = None,
        image_urls: list[str] | None = None,
        routing_content: str | None = None,
    ) -> AgentRunResult:
        provider = self._models.get(self._model_provider)
        selected_platform = platform_name or self._platform_name
        route = route_task(routing_content or user_content, set(self._tools.names()))
        plan = None
        events: list[ToolEvent] = [
            ToolEvent(
                round=0,
                tool_call_id="agent-thinking",
                tool_name="agent_thinking",
                status="done",
                message=route_summary(route),
                data={"route": route.kind, "allowed_tools": list(route.allowed_tools)},
            )
        ]
        await self._publish(event_callback, AgentStreamEvent(type="agent_event", event=events[0]))
        unresolved_error: ToolError | None = None

        if route.needs_plan:
            try:
                planning_response = await provider.generate(
                    ModelRequest(
                        messages=[AgentMessage(role="user", content=planner_prompt(user_content, route))]
                    )
                )
                plan = parse_plan(planning_response, user_content, route)
            except ModelProviderError as exc:
                event = ToolEvent(
                        round=0,
                        tool_call_id="agent-plan",
                        tool_name="agent_planner",
                        status="failed",
                        message=f"规划失败：{exc}",
                        data={"code": exc.code, "retryable": exc.retryable},
                    )
                events.append(event)
                await self._publish(event_callback, AgentStreamEvent(type="agent_event", event=event))
                return AgentRunResult(
                    content=f"任务规划失败：{exc}。本次执行已终止，请处理后重新提问。",
                    provider=self._model_provider,
                    platform=selected_platform,
                    rounds=0,
                    status="failed",
                    error=ToolError(code=exc.code, message=str(exc), retryable=exc.retryable),
                    events=events,
                )
            except Exception:
                error = ToolError(code="planning_failed", message="模型未能生成执行计划")
                event = ToolEvent(
                        round=0,
                        tool_call_id="agent-plan",
                        tool_name="agent_planner",
                        status="failed",
                        message="模型未能生成执行计划",
                    )
                events.append(event)
                await self._publish(event_callback, AgentStreamEvent(type="agent_event", event=event))
                return AgentRunResult(
                    content="模型未能生成执行计划。本次执行已终止，请重新提问。",
                    provider=self._model_provider,
                    platform=selected_platform,
                    rounds=0,
                    status="failed",
                    error=error,
                    events=events,
                )
            event = ToolEvent(
                    round=0,
                    tool_call_id="agent-plan",
                    tool_name="agent_planner",
                    status="done",
                    message=f"已规划 {len(plan.steps)} 个步骤：{plan.goal}",
                    data={"route": route.kind, "plan": plan.model_dump(mode="json")},
                )
            events.append(event)
            await self._publish(event_callback, AgentStreamEvent(type="agent_event", event=event))

        messages = [*(history or [])]
        if plan is not None:
            messages.append(
                AgentMessage(
                    role="system",
                    content=(
                        "当前任务已经过规划。只执行计划中允许的工具；每次根据工具结果判断下一步，"
                        "任一步骤失败或被阻止时立即停止，不要继续调用其他工具。计划："
                        + plan.model_dump_json()
                    ),
                )
            )
        messages.append(
            AgentMessage(
                role="user",
                content=user_content,
                payload={"image_urls": image_urls or []} if image_urls else {},
            )
        )
        planned_tools = {step.tool_name for step in plan.steps} if plan is not None else set()
        tool_definitions = [
            definition
            for definition in self._tools.definitions()
            if definition.name in planned_tools
        ]

        for round_number in range(1, self._max_tool_rounds + 1):
            await self._publish(event_callback, AgentStreamEvent(type="text_reset"))
            try:
                response = await self._generate_response(
                    provider,
                    ModelRequest(messages=messages, tools=tool_definitions),
                    event_callback,
                )
            except ModelProviderError as exc:
                event = ToolEvent(
                        round=round_number,
                        tool_call_id=f"model-round-{round_number}",
                        tool_name="model_provider",
                        status="failed",
                        message=str(exc),
                        data={"code": exc.code, "retryable": exc.retryable},
                    )
                events.append(event)
                await self._publish(event_callback, AgentStreamEvent(type="agent_event", event=event))
                return AgentRunResult(
                    content=f"模型服务不可用：{exc}。本次执行已终止，请处理后重新提问。",
                    provider=self._model_provider,
                    platform=selected_platform,
                    rounds=round_number,
                    status="failed",
                    error=ToolError(code=exc.code, message=str(exc), retryable=exc.retryable),
                    events=events,
                    plan=plan,
                )
            except Exception:
                event = ToolEvent(
                        round=round_number,
                        tool_call_id=f"model-round-{round_number}",
                        tool_name="model_provider",
                        status="failed",
                        message="模型服务发生未知异常",
                        data={"code": "unknown_model_error", "retryable": False},
                    )
                events.append(event)
                await self._publish(event_callback, AgentStreamEvent(type="agent_event", event=event))
                return AgentRunResult(
                    content="模型服务发生未知异常。本次执行已终止，请检查服务日志后重新提问。",
                    provider=self._model_provider,
                    platform=selected_platform,
                    rounds=round_number,
                    status="failed",
                    error=ToolError(
                        code="unknown_model_error",
                        message="模型服务发生未知异常",
                    ),
                    events=events,
                    plan=plan,
                )
            if response.content and not response.tool_calls:
                return AgentRunResult(
                    content=response.content,
                    provider=self._model_provider,
                    platform=selected_platform,
                    rounds=round_number,
                    status="failed" if unresolved_error else "done",
                    error=unresolved_error,
                    events=events,
                    plan=plan,
                )

            if not response.tool_calls:
                return AgentRunResult(
                    content="模型没有返回可执行工具或最终回答。本次执行已终止，请重新提问。",
                    provider=self._model_provider,
                    platform=selected_platform,
                    rounds=round_number,
                    status="failed",
                    error=ToolError(
                        code="empty_model_response",
                        message="模型没有返回可执行工具或最终回答",
                    ),
                    events=events,
                    plan=plan,
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
            round_error: ToolError | None = None
            for tool_call in response.tool_calls:
                if tool_call.name not in planned_tools:
                    message = f"风险门已阻止计划外工具：{tool_call.name}"
                    round_error = ToolError(code="tool_not_planned", message=message)
                    event = ToolEvent(
                            round=round_number,
                            tool_call_id=tool_call.id,
                            tool_name=tool_call.name,
                            status="blocked",
                            message=message,
                            data={"route": route.kind},
                        )
                    events.append(event)
                    await self._publish(event_callback, AgentStreamEvent(type="agent_event", event=event))
                    return AgentRunResult(
                        content=f"{message}。本次执行已终止，请调整要求后重新提问。",
                        provider=self._model_provider,
                        platform=selected_platform,
                        rounds=round_number,
                        status="failed",
                        error=round_error,
                        events=events,
                        plan=plan,
                    )
                plan_step = next(
                    (step for step in plan.steps if step.tool_name == tool_call.name),
                    None,
                ) if plan is not None else None
                if plan_step is not None:
                    plan_step.status = "running"
                await self._publish(
                    event_callback,
                    AgentStreamEvent(
                        type="agent_event",
                        event=ToolEvent(
                            round=round_number,
                            tool_call_id=tool_call.id,
                            tool_name=tool_call.name,
                            status="running",
                            message="正在执行",
                        ),
                    ),
                )
                try:
                    handler = self._tools.get(tool_call.name)
                    result = await handler.execute(
                        tool_call.arguments,
                        ToolContext(
                            platform_name=selected_platform,
                            conversation_id=conversation_id,
                            task_id=task_id,
                        ),
                    )
                except Exception as exc:
                    result_data = {"status": "failed", "error": str(exc)}
                    round_error = ToolError(
                        code="tool_execution_failed",
                        message=f"工具执行失败：{exc}",
                    )
                    event = ToolEvent(
                            round=round_number,
                            tool_call_id=tool_call.id,
                            tool_name=tool_call.name,
                            status="failed",
                            message=f"工具执行失败：{exc}",
                            data=result_data,
                        )
                    events.append(event)
                    await self._publish(event_callback, AgentStreamEvent(type="agent_event", event=event))
                    if plan_step is not None:
                        plan_step.status = "failed"
                    return AgentRunResult(
                        content=f"工具执行失败：{exc}。本次执行已终止，请处理后重新提问。",
                        provider=self._model_provider,
                        platform=selected_platform,
                        rounds=round_number,
                        status="failed",
                        error=round_error,
                        events=events,
                        plan=plan,
                    )

                event = ToolEvent(
                        round=round_number,
                        tool_call_id=tool_call.id,
                        tool_name=tool_call.name,
                        status=result.status,
                        message=result.message,
                        data=result.data,
                    )
                events.append(event)
                await self._publish(event_callback, AgentStreamEvent(type="agent_event", event=event))
                if plan_step is not None:
                    plan_step.status = (
                        "done" if result.status == "done"
                        else "blocked" if result.status in {"blocked", "waiting_approval"}
                        else "failed"
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
                if result.status in {"failed", "blocked"}:
                    round_error = result.error or ToolError(
                        code=f"tool_{result.status}", message=result.message
                    )
                    return AgentRunResult(
                        content=f"{result.message}。本次执行已终止，请处理后重新提问。",
                        provider=self._model_provider,
                        platform=selected_platform,
                        rounds=round_number,
                        status="failed",
                        error=round_error,
                        events=events,
                        plan=plan,
                    )
                if result.status == "waiting_approval":
                    return AgentRunResult(
                        content=result.message,
                        provider=self._model_provider,
                        platform=selected_platform,
                        rounds=round_number,
                        status="waiting_user",
                        error=result.error,
                        events=events,
                        plan=plan,
                    )
            unresolved_error = round_error

        return AgentRunResult(
            content=f"Agent 已达到最大工具调用轮数（{self._max_tool_rounds}），本次执行已终止，请缩小任务范围后重新提问。",
            provider=self._model_provider,
            platform=selected_platform,
            rounds=self._max_tool_rounds,
            status="failed",
            error=ToolError(
                code="round_limit_reached",
                message="Agent 已达到最大工具调用轮数",
            ),
            events=events,
            plan=plan,
        )

    async def run_stream(
        self,
        user_content: str,
        platform_name: str | None = None,
        history: list[AgentMessage] | None = None,
        conversation_id: int | None = None,
        task_id: int | None = None,
        image_urls: list[str] | None = None,
        routing_content: str | None = None,
    ) -> AsyncIterator[AgentStreamEvent]:
        queue: asyncio.Queue[AgentStreamEvent | None] = asyncio.Queue()

        async def publish(event: AgentStreamEvent) -> None:
            await queue.put(event)

        async def execute() -> None:
            try:
                await queue.put(AgentStreamEvent(type="run_started"))
                result = await self.run(
                    user_content,
                    platform_name=platform_name,
                    history=history,
                    conversation_id=conversation_id,
                    task_id=task_id,
                    event_callback=publish,
                    image_urls=image_urls,
                    routing_content=routing_content,
                )
                if result.status == "waiting_user":
                    await queue.put(AgentStreamEvent(type="waiting_user", result=result))
                await queue.put(AgentStreamEvent(type="completed", result=result))
            except asyncio.CancelledError:
                await queue.put(AgentStreamEvent(type="cancelled"))
            except Exception as exc:
                await queue.put(
                    AgentStreamEvent(
                        type="error",
                        result=AgentRunResult(
                            content="Agent 流式执行发生未知异常。",
                            provider=self._model_provider,
                            platform=platform_name or self._platform_name,
                            rounds=0,
                            status="failed",
                            error=ToolError(code="stream_failed", message=str(exc)),
                        ),
                    )
                )
            finally:
                await queue.put(None)

        task = asyncio.create_task(execute())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield event
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _generate_response(
        self,
        provider,
        request: ModelRequest,
        event_callback: StreamCallback | None,
    ) -> ModelResponse:
        stream = getattr(provider, "stream", None)
        if event_callback is None or not callable(stream):
            response = await provider.generate(request)
            if event_callback is not None and response.content:
                await self._publish(
                    event_callback,
                    AgentStreamEvent(type="text_delta", delta=response.content),
                )
            return response

        response: ModelResponse | None = None
        async for event in stream(request):
            if event.type == "text_delta" and event.delta:
                await self._publish(
                    event_callback,
                    AgentStreamEvent(type="text_delta", delta=event.delta),
                )
            elif event.type == "completed":
                response = event.response
        if response is None:
            raise ModelProviderError(
                "empty_stream",
                "模型流已结束，但没有返回完整响应",
                retryable=True,
            )
        return response

    @staticmethod
    async def _publish(
        callback: StreamCallback | None,
        event: AgentStreamEvent,
    ) -> None:
        if callback is not None:
            await callback(event)

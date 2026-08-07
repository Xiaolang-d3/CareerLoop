from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from time import perf_counter
from urllib.parse import urlsplit, urlunsplit

from ..domain import (
    AgentMessage,
    AgentRunResult,
    AgentStreamEvent,
    ModelRequest,
    ModelResponse,
    ToolError,
    ToolEvent,
)
from ..candidate_core import get_profile_interview_session
from ..models import ModelProviderError, ModelProviderRegistry
from ..tool_call_audit import record_tool_call_event
from ..tools import ToolContext, ToolRegistry
from .orchestration import parse_plan, planner_prompt, route_summary, route_task


StreamCallback = Callable[[AgentStreamEvent], Awaitable[None]]
WEB_RESEARCH_TOOLS = {"research_company", "search_public_web"}
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\((https?://[^)\s]+)\)")
COMPANY_REFERENCE_PHRASES = ("这家公司", "该公司", "这个公司", "这家企业", "该企业")
COMPANY_SUFFIX = r"(?:有限责任公司|股份有限公司|有限公司)"
COMPANY_CONTEXT_PATTERNS = (
    re.compile(rf"公司名称\s*\|\s*\**\s*([^|*\n]{{2,100}}?{COMPANY_SUFFIX})"),
    re.compile(rf"主体(?:更像是|是|为)\s*\**\s*([^*，。\n]{{2,100}}?{COMPANY_SUFFIX})"),
    re.compile(rf"“([^”\n]{{2,100}}?{COMPANY_SUFFIX})”"),
    re.compile(rf"\*\*([^*\n]{{2,100}}?{COMPANY_SUFFIX})\*\*"),
)


def _active_profile_interview(conversation_id: int | None) -> dict | None:
    """Return the running interview session for this conversation, if any.

    Read from stored state rather than the message text, so a plain answer like
    "AI 产品经理，上海" still keeps the interview tools available.
    """
    if conversation_id is None:
        return None
    try:
        session = get_profile_interview_session(conversation_id)
    except Exception:
        return None
    if not session or session.get("status") != "active":
        return None
    return session


def _canonical_citation_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    return urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path.rstrip("/"),
            parsed.query,
            "",
        )
    )


def _web_source_urls(messages: list[AgentMessage]) -> set[str]:
    urls: set[str] = set()
    for message in messages:
        if message.role != "tool" or message.payload.get("tool_name") not in WEB_RESEARCH_TOOLS:
            continue
        for source in message.payload.get("sources", []):
            if isinstance(source, dict) and isinstance(source.get("url"), str):
                urls.add(_canonical_citation_url(source["url"]))
    return urls


def _validate_web_citations(content: str, allowed_urls: set[str]) -> tuple[bool, str]:
    cited = {_canonical_citation_url(url) for url in MARKDOWN_LINK_RE.findall(content)}
    if not cited:
        return False, "回答没有使用 Markdown 链接引用本轮搜索来源"
    unknown = cited - allowed_urls
    if unknown:
        return False, "回答引用了本轮搜索结果之外的网址"
    return True, ""


def _recent_company_name(history: list[AgentMessage]) -> str | None:
    for message in reversed(history):
        for pattern in COMPANY_CONTEXT_PATTERNS:
            match = pattern.search(message.content)
            if match:
                return match.group(1).strip(" \t，。、“”\"")
    return None


class AgentRuntime:
    def __init__(
        self,
        models: ModelProviderRegistry,
        tools: ToolRegistry,
        model_provider: str,
        platform_name: str,
        max_tool_rounds: int,
        tool_timeout_seconds: float = 60,
    ) -> None:
        self._models = models
        self._tools = tools
        self._model_provider = model_provider
        self._platform_name = platform_name
        self._max_tool_rounds = max_tool_rounds
        self._tool_timeout_seconds = tool_timeout_seconds

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
        interview_session = _active_profile_interview(conversation_id)
        route = route_task(
            routing_content or user_content,
            set(self._tools.names()),
            profile_interview_active=interview_session is not None,
        )
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

        conversation_history = history or []
        messages = [*conversation_history]
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
        if interview_session is not None:
            messages.append(
                AgentMessage(
                    role="system",
                    content=(
                        "当前会话有一个进行中的画像访谈，正在等待用户回答："
                        f"“{interview_session.get('question') or ''}”。"
                        "如果用户本轮内容像是在回答这个问题，调用 "
                        "record_profile_interview_answer 保存并推进到下一题；"
                        "如果用户要求暂停，调用 pause_profile_interview；"
                        "如果用户明显在问别的事情，就正常处理，不要调用访谈工具。"
                    ),
                )
            )
        recent_company = _recent_company_name(conversation_history)
        if recent_company and any(
            phrase in user_content for phrase in COMPANY_REFERENCE_PHRASES
        ):
            focus_instruction = ""
            if any(word in user_content.lower() for word in ("boss", "直聘", "岗位", "职位", "招聘")):
                focus_instruction = (
                    "本轮是在查询该公司的公开招聘岗位；调用 research_company 时，"
                    "focus 必须包含“BOSS直聘”和“招聘岗位”。"
                )
            messages.append(
                AgentMessage(
                    role="system",
                    content=(
                        f"已从最近对话中解析出：本轮“这家公司/该公司”指代"
                        f"“{recent_company}”。调用公司或联网搜索工具时必须使用这个完整公司名，"
                        "不得把“这家公司”“BOSS直聘”或用户整句话当作公司名称。"
                        + focus_instruction
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
        citation_retry_used = False

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
                allowed_source_urls = _web_source_urls(messages)
                if allowed_source_urls:
                    citations_valid, citation_error = _validate_web_citations(
                        response.content,
                        allowed_source_urls,
                    )
                    if not citations_valid and not citation_retry_used:
                        citation_retry_used = True
                        event = ToolEvent(
                            round=round_number,
                            tool_call_id=f"citation-validation-{round_number}",
                            tool_name="citation_validator",
                            status="running",
                            message=f"{citation_error}，正在自动修正",
                            data={"allowed_source_count": len(allowed_source_urls)},
                        )
                        events.append(event)
                        await self._publish(
                            event_callback,
                            AgentStreamEvent(type="agent_event", event=event),
                        )
                        messages.append(AgentMessage(role="assistant", content=response.content))
                        messages.append(
                            AgentMessage(
                                role="system",
                                content=(
                                    f"{citation_error}。请仅依据本轮工具返回的 evidence 重写回答；"
                                    "每项可核验事实后必须添加 Markdown 来源链接，不得添加其他网址。"
                                    "若证据不足，明确写“暂未核实”，不要猜测。允许引用的网址："
                                    + "\n".join(sorted(allowed_source_urls))
                                ),
                            )
                        )
                        tool_definitions = []
                        continue
                    if not citations_valid:
                        return AgentRunResult(
                            content=(
                                response.content
                                + "\n\n> 此回答未通过来源引用校验，请勿将其视为已核验结论。"
                            ),
                            provider=self._model_provider,
                            platform=selected_platform,
                            rounds=round_number,
                            status="failed",
                            error=ToolError(
                                code="citation_validation_failed",
                                message=citation_error,
                            ),
                            events=events,
                            plan=plan,
                        )
                    if citation_retry_used:
                        event = ToolEvent(
                            round=round_number,
                            tool_call_id=f"citation-validation-{round_number}",
                            tool_name="citation_validator",
                            status="done",
                            message="来源引用校验通过",
                            data={"allowed_source_count": len(allowed_source_urls)},
                        )
                        events.append(event)
                        await self._publish(
                            event_callback,
                            AgentStreamEvent(type="agent_event", event=event),
                        )
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
                started_at = perf_counter()
                try:
                    handler = self._tools.get(tool_call.name)
                    result = await asyncio.wait_for(
                        handler.execute(
                            tool_call.arguments,
                            ToolContext(
                                platform_name=selected_platform,
                                conversation_id=conversation_id,
                                task_id=task_id,
                                user_content=user_content,
                            ),
                        ),
                        timeout=self._tool_timeout_seconds,
                    )
                except asyncio.TimeoutError:
                    self._record_tool_call(
                        conversation_id, round_number, tool_call.id, tool_call.name,
                        "failed", started_at, error_code="tool_timeout",
                    )
                    message = f"工具 {tool_call.name} 执行超时"
                    round_error = ToolError(
                        code="tool_timeout",
                        message=message,
                        retryable=True,
                    )
                    event = ToolEvent(
                            round=round_number,
                            tool_call_id=tool_call.id,
                            tool_name=tool_call.name,
                            status="failed",
                            message=message,
                            data={"status": "failed", "error": "timeout"},
                        )
                    events.append(event)
                    await self._publish(event_callback, AgentStreamEvent(type="agent_event", event=event))
                    if plan_step is not None:
                        plan_step.status = "failed"
                    return AgentRunResult(
                        content=f"{message}。本次执行已终止，请处理后重新提问。",
                        provider=self._model_provider,
                        platform=selected_platform,
                        rounds=round_number,
                        status="failed",
                        error=round_error,
                        events=events,
                        plan=plan,
                    )
                except Exception as exc:
                    self._record_tool_call(
                        conversation_id, round_number, tool_call.id, tool_call.name,
                        "failed", started_at, error_code="tool_execution_failed",
                    )
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

                self._record_tool_call(
                    conversation_id, round_number, tool_call.id, tool_call.name,
                    result.status, started_at,
                    error_code=result.error.code if result.error else "",
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

    @staticmethod
    def _record_tool_call(
        conversation_id: int | None,
        round_number: int,
        tool_call_id: str,
        tool_name: str,
        status: str,
        started_at: float,
        *,
        error_code: str = "",
    ) -> None:
        try:
            record_tool_call_event(
                conversation_id=conversation_id,
                round_number=round_number,
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                status=status,
                latency_ms=round((perf_counter() - started_at) * 1000),
                error_code=error_code,
            )
        except Exception:
            # Auditing is best-effort and must never break a successful tool call.
            pass

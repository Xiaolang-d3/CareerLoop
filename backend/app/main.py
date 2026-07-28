from __future__ import annotations

import asyncio
import json
from typing import Any

from ag_ui.core import (
    CustomEvent,
    ReasoningEndEvent,
    ReasoningMessageContentEvent,
    ReasoningMessageEndEvent,
    ReasoningMessageStartEvent,
    ReasoningStartEvent,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from .agent import get_agent_runtime
from .api import resources_router
from .api.dependencies import require_conversation
from .api.schemas import ChatMessageIn
from .conversations import (
    end_active_task,
    ensure_active_task,
    maybe_title_from_first_message,
)
from .db import connect, init_db, json_dump, row_to_dict, rows_to_dicts
from .domain import AgentRunResult, ToolError, ToolEvent
from .services.chat import (
    agent_history as _agent_history,
    attachment_context as _attachment_context,
    default_conversation_id as _default_conversation_id,
    is_workflow_status_query as _is_workflow_status_query,
    local_answer_result as _local_answer_result,
    refresh_conversation_summary as _refresh_conversation_summary,
    save_chat_message as _save_chat_message,
    save_stream_result as _save_stream_result,
    workflow_summary as _workflow_summary,
)
from .workflow.engine import refresh_workflow_status


app = FastAPI(title="BossCopilot API", version="0.1.0")

_active_chat_runs: dict[int, asyncio.Task[None]] = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resources_router)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/chat/messages")
def list_chat_messages(conversation_id: int | None = None) -> list[dict[str, Any]]:
    resolved_id = conversation_id or _default_conversation_id()
    require_conversation(resolved_id)
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC",
            (resolved_id,),
        ).fetchall()
    return rows_to_dicts(rows)


@app.delete("/chat/messages/{message_id}/tail")
def rewind_chat_messages(message_id: int, conversation_id: int | None = None) -> dict[str, Any]:
    """Remove a user turn and everything after it before editing or regenerating."""
    resolved_id = conversation_id or _default_conversation_id()
    require_conversation(resolved_id)
    active = _active_chat_runs.get(resolved_id)
    if active is not None and not active.done():
        raise HTTPException(status_code=409, detail="请先停止当前生成任务")

    with connect() as conn:
        message = conn.execute(
            "SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?",
            (message_id, resolved_id),
        ).fetchone()
        if message is None:
            raise HTTPException(status_code=404, detail="消息不存在")
        if message["role"] != "user":
            raise HTTPException(status_code=400, detail="只能从用户消息开始回退")
        deleted = conn.execute(
            "DELETE FROM chat_messages WHERE conversation_id = ? AND id >= ?",
            (resolved_id, message_id),
        ).rowcount
        conversation = conn.execute(
            "SELECT title FROM conversations WHERE id = ?", (resolved_id,)
        ).fetchone()
        generated_title = " ".join(message["content"].strip().split())[:28] or "新对话"
        next_title = "新对话" if conversation and conversation["title"] == generated_title else conversation["title"]
        conn.execute(
            """
            UPDATE conversations
            SET title = ?, context_cutoff_message_id = MIN(context_cutoff_message_id, ?),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (next_title, max(message_id - 1, 0), resolved_id),
        )

    end_active_task(resolved_id)
    _refresh_conversation_summary(resolved_id)
    return {
        "rewound": True,
        "deleted": deleted,
        "source_message": row_to_dict(message),
    }


@app.post("/agent/tasks/current/cancel")
async def cancel_current_agent_task(conversation_id: int | None = None) -> dict[str, Any]:
    resolved_id = conversation_id or _default_conversation_id()
    require_conversation(resolved_id)
    cancelled = False
    active_task = _active_chat_runs.get(resolved_id)
    if active_task is not None and not active_task.done():
        active_task.cancel()
        cancelled = True
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, payload_json FROM chat_messages WHERE role = 'assistant' AND conversation_id = ? ORDER BY id DESC",
            (resolved_id,),
        ).fetchall()
        for row in rows:
            payload = json.loads(row["payload_json"] or "{}")
            agent = payload.get("agent")
            if not agent or agent.get("status") not in {"waiting_user", "failed"}:
                continue
            agent["status"] = "cancelled"
            agent["error"] = None
            payload["agent"] = agent
            conn.execute(
                "UPDATE chat_messages SET payload_json = ? WHERE id = ?",
                (json_dump(payload), row["id"]),
            )
            cancelled = True
            break

        conn.execute(
            """
            UPDATE workflow_nodes
            SET status = 'pending', detail = '上一任务已由用户结束', updated_at = CURRENT_TIMESTAMP
            WHERE status IN ('running', 'blocked') AND run_id = (
                SELECT id FROM workflow_runs WHERE name = ? ORDER BY id DESC LIMIT 1
            )
            """,
            (f"conversation-{resolved_id}",),
        )
    end_active_task(resolved_id)
    return {"cancelled": cancelled, "workflow": refresh_workflow_status(resolved_id)}


def _ag_ui_message_content(payload: RunAgentInput) -> str:
    for message in reversed(payload.messages):
        if message.role != "user":
            continue
        if isinstance(message.content, str):
            return message.content.strip()
        text_parts = []
        for part in message.content:
            if getattr(part, "type", None) == "text":
                text_parts.append(getattr(part, "text", ""))
        return "\n".join(text_parts).strip()
    return ""


def _ag_ui_attachment_ids(payload: RunAgentInput) -> list[str]:
    forwarded = payload.forwarded_props or {}
    raw_ids = forwarded.get("attachmentIds", []) if isinstance(forwarded, dict) else []
    if not isinstance(raw_ids, list) or any(not isinstance(item, str) for item in raw_ids):
        raise HTTPException(status_code=422, detail="attachmentIds 必须是附件 ID 数组")
    return raw_ids[:8]


def _ag_ui_vision_attachment_ids(payload: RunAgentInput) -> list[str]:
    forwarded = payload.forwarded_props or {}
    raw_ids = forwarded.get("visionAttachmentIds", []) if isinstance(forwarded, dict) else []
    if not isinstance(raw_ids, list) or any(not isinstance(item, str) for item in raw_ids):
        raise HTTPException(status_code=422, detail="visionAttachmentIds 必须是附件 ID 数组")
    return raw_ids[:4]


def _ag_ui_web_search(payload: RunAgentInput) -> bool:
    forwarded = payload.forwarded_props or {}
    value = forwarded.get("webSearch", False) if isinstance(forwarded, dict) else False
    if not isinstance(value, bool):
        raise HTTPException(status_code=422, detail="webSearch 必须是布尔值")
    return value


async def _stream_chat_message_response(
    payload: ChatMessageIn,
    *,
    ag_ui_input: RunAgentInput,
    accept: str | None = None,
) -> StreamingResponse:
    conversation_id = payload.conversation_id or _default_conversation_id()
    require_conversation(conversation_id)
    active = _active_chat_runs.get(conversation_id)
    if active is not None and not active.done():
        raise HTTPException(status_code=409, detail="当前对话已有正在执行的任务")

    task_id = ensure_active_task(conversation_id)
    attachment_context, attachment_summaries, image_urls = _attachment_context(
        conversation_id, payload.attachment_ids, payload.vision_attachment_ids
    )
    user_payload: dict[str, Any] = {}
    if attachment_summaries:
        user_payload["attachments"] = attachment_summaries
    if payload.web_search:
        user_payload["web_search"] = True
    user_message = _save_chat_message(
        "user",
        payload.content,
        user_payload or None,
        conversation_id,
        task_id,
    )
    maybe_title_from_first_message(conversation_id, payload.content)
    history = _agent_history(conversation_id, user_message["id"])
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()

    async def execute() -> None:
        partial_content = ""
        streamed_events: dict[str, ToolEvent] = {}
        current_task = asyncio.current_task()
        try:
            await queue.put(("run_started", {"user_message": user_message}))
            agent_input = payload.content
            if attachment_context:
                agent_input += f"\n\n以下为用户主动上传附件的本地解析文本，请基于此内容回答：\n{attachment_context}"
            text = payload.content.lower()
            if ("boss" in text or "直聘" in text) and ("打开" in text or "登录" in text):
                workflow = refresh_workflow_status(conversation_id)
                assistant_text = "请点击页面中的“打开 BOSS”，由你在普通浏览器标签页完成登录和搜索；系统不会自动控制或刷新 BOSS 页面。"
                result = _local_answer_result(
                    assistant_text,
                    "已识别为外部平台操作请求；根据安全边界，不调用自动化工具，交由用户本人操作",
                    "external_handoff",
                )
                await queue.put(("text_reset", {}))
                await queue.put(("text_delta", {"delta": assistant_text}))
            elif _is_workflow_status_query(payload.content):
                workflow = refresh_workflow_status(conversation_id)
                assistant_text = _workflow_summary(workflow)
                result = _local_answer_result(
                    assistant_text,
                    "已识别为本地工作流进度查询，直接读取当前状态摘要，无需进入工具循环",
                    "workflow_status",
                )
                await queue.put(("text_reset", {}))
                await queue.put(("text_delta", {"delta": assistant_text}))
            else:
                result = None
                trusted_routing_content = payload.content.replace(
                    "[系统可信开关：本轮允许联网搜索]",
                    "",
                )
                if payload.web_search:
                    trusted_routing_content += "\n[系统可信开关：本轮允许联网搜索]"
                if any(
                    item.get("kind") == "job_screenshot"
                    for item in attachment_summaries
                ):
                    trusted_routing_content += "\n[系统确认：本轮请求分析岗位截图]"
                async for stream_event in get_agent_runtime().run_stream(
                    agent_input,
                    history=history,
                    conversation_id=conversation_id,
                    task_id=task_id,
                    image_urls=image_urls,
                    routing_content=trusted_routing_content,
                ):
                    if stream_event.type == "text_delta":
                        partial_content += stream_event.delta
                        await queue.put(("text_delta", {"delta": stream_event.delta}))
                    elif stream_event.type == "text_reset":
                        partial_content = ""
                        await queue.put(("text_reset", {}))
                    elif stream_event.type == "agent_event" and stream_event.event is not None:
                        streamed_events[stream_event.event.tool_call_id] = stream_event.event
                        await queue.put(
                            ("agent_event", {"event": stream_event.event.model_dump(mode="json")})
                        )
                    elif stream_event.type in {"completed", "error"}:
                        result = stream_event.result
                    elif stream_event.type == "waiting_user":
                        await queue.put(("waiting_user", {}))
                if result is None:
                    raise RuntimeError("Agent 流已结束，但没有返回结果")

            completed = _save_stream_result(conversation_id, task_id, user_message, result)
            await queue.put(("completed", completed))
        except asyncio.CancelledError:
            cancel_event = ToolEvent(
                round=0,
                tool_call_id="user-cancelled",
                tool_name="model_provider",
                status="cancelled",
                message="用户已停止生成",
            )
            streamed_events[cancel_event.tool_call_id] = cancel_event
            cancelled_result = AgentRunResult(
                content=partial_content.strip() or "已停止生成。",
                provider="openai",
                platform="manual",
                rounds=0,
                status="cancelled",
                error=ToolError(code="user_cancelled", message="用户已停止生成"),
                events=list(streamed_events.values()),
            )
            completed = _save_stream_result(
                conversation_id, task_id, user_message, cancelled_result
            )
            await queue.put(("cancelled", completed))
        except Exception as exc:
            failed_result = AgentRunResult(
                content="流式执行发生异常，本次任务已终止。",
                provider="openai",
                platform="manual",
                rounds=0,
                status="failed",
                error=ToolError(code="stream_failed", message=str(exc), retryable=True),
                events=list(streamed_events.values()),
            )
            completed = _save_stream_result(conversation_id, task_id, user_message, failed_result)
            await queue.put(("error", {**completed, "message": str(exc)}))
        finally:
            if _active_chat_runs.get(conversation_id) is current_task:
                _active_chat_runs.pop(conversation_id, None)
            await queue.put(None)

    worker = asyncio.create_task(execute())
    _active_chat_runs[conversation_id] = worker

    async def ag_ui_event_stream():
        encoder = EventEncoder(accept=accept)
        thread_id = ag_ui_input.thread_id
        run_id = ag_ui_input.run_id
        message_generation = 0
        assistant_message_id = f"{run_id}:assistant:{message_generation}"
        text_started = False
        started_tool_calls: set[str] = set()

        def encode(event: Any) -> str:
            return encoder.encode(event)

        def start_text_message() -> str | None:
            nonlocal text_started
            if text_started:
                return None
            text_started = True
            return encode(TextMessageStartEvent(messageId=assistant_message_id, role="assistant"))

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                event_name, data = item
                if event_name == "run_started":
                    yield encode(RunStartedEvent(threadId=thread_id, runId=run_id))
                    yield encode(CustomEvent(name="bosscopilot.user_message", value=data["user_message"]))
                    continue
                if event_name == "text_reset":
                    if text_started:
                        yield encode(TextMessageEndEvent(messageId=assistant_message_id))
                        message_generation += 1
                        assistant_message_id = f"{run_id}:assistant:{message_generation}"
                        text_started = False
                    started = start_text_message()
                    if started:
                        yield started
                    continue
                if event_name == "text_delta":
                    delta = data.get("delta", "")
                    if not delta:
                        continue
                    started = start_text_message()
                    if started:
                        yield started
                    yield encode(TextMessageContentEvent(messageId=assistant_message_id, delta=delta))
                    continue
                if event_name == "agent_event":
                    tool_event = data["event"]
                    tool_call_id = tool_event["tool_call_id"]
                    tool_name = tool_event["tool_name"]
                    if tool_name == "agent_thinking":
                        reasoning_id = f"reasoning:{tool_call_id}"
                        yield encode(ReasoningStartEvent(messageId=reasoning_id))
                        yield encode(ReasoningMessageStartEvent(messageId=reasoning_id, role="reasoning"))
                        if tool_event.get("message"):
                            yield encode(ReasoningMessageContentEvent(
                                messageId=reasoning_id,
                                delta=tool_event["message"],
                            ))
                        yield encode(ReasoningMessageEndEvent(messageId=reasoning_id))
                        yield encode(ReasoningEndEvent(messageId=reasoning_id))
                        continue
                    if tool_call_id not in started_tool_calls:
                        started_tool_calls.add(tool_call_id)
                        yield encode(ToolCallStartEvent(
                            toolCallId=tool_call_id,
                            toolCallName=tool_name,
                            parentMessageId=assistant_message_id,
                        ))
                        yield encode(ToolCallArgsEvent(
                            toolCallId=tool_call_id,
                            delta=json.dumps(tool_event.get("data") or {}, ensure_ascii=False),
                        ))
                    if tool_event.get("status") != "running":
                        yield encode(ToolCallEndEvent(toolCallId=tool_call_id))
                        yield encode(ToolCallResultEvent(
                            messageId=f"tool-result:{tool_call_id}",
                            toolCallId=tool_call_id,
                            content=json.dumps(tool_event, ensure_ascii=False),
                            role="tool",
                        ))
                    continue
                if event_name in {"completed", "cancelled", "error"}:
                    if text_started:
                        yield encode(TextMessageEndEvent(messageId=assistant_message_id))
                    assistant_payload = data["assistant_message"].get("payload") or {}
                    agent_payload = assistant_payload.get("agent") or {}
                    status = (
                        "cancelled"
                        if event_name == "cancelled"
                        else "failed"
                        if event_name == "error"
                        else agent_payload.get("status", "done")
                    )
                    snapshot = {
                        "workflow": data["workflow"],
                        "bossCopilot": {
                            "status": status,
                            "userMessage": data["user_message"],
                            "assistantMessage": data["assistant_message"],
                        },
                    }
                    yield encode(StateSnapshotEvent(snapshot=snapshot))
                    if event_name == "cancelled":
                        yield encode(CustomEvent(name="bosscopilot.cancelled", value={"status": status}))
                    if status == "failed":
                        agent_error = agent_payload.get("error") or {}
                        yield encode(RunErrorEvent(
                            message=agent_error.get("message") or data.get("message", "流式执行失败"),
                            code=agent_error.get("code") or "stream_failed",
                        ))
                    else:
                        yield encode(RunFinishedEvent(
                            threadId=thread_id,
                            runId=run_id,
                            result={
                                "status": status,
                                "assistantMessageId": data["assistant_message"]["id"],
                            },
                        ))
        finally:
            if not worker.done():
                worker.cancel()
                await asyncio.gather(worker, return_exceptions=True)

    return StreamingResponse(
        ag_ui_event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/ag-ui")
async def run_ag_ui(payload: dict[str, Any], request: Request) -> StreamingResponse:
    """AG-UI standard HTTP/SSE endpoint."""
    try:
        ag_ui_input = RunAgentInput.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False)) from exc
    try:
        conversation_id = int(ag_ui_input.thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="threadId 必须是本地对话 ID") from exc
    content = _ag_ui_message_content(ag_ui_input)
    if not content:
        raise HTTPException(status_code=422, detail="messages 中缺少用户文本消息")
    return await _stream_chat_message_response(
        ChatMessageIn(
            content=content,
            conversation_id=conversation_id,
            attachment_ids=_ag_ui_attachment_ids(ag_ui_input),
            vision_attachment_ids=_ag_ui_vision_attachment_ids(ag_ui_input),
            web_search=_ag_ui_web_search(ag_ui_input),
        ),
        ag_ui_input=ag_ui_input,
        accept=request.headers.get("accept"),
    )

from __future__ import annotations

import asyncio
import json
from typing import Any
from ag_ui.core import RunAgentInput
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from ..agent import get_agent_runtime
from .conversations import get_conversation
from .contracts import ChatMessageIn
from ..workspace import current_user_id
from .conversations import end_active_task, ensure_active_task, maybe_title_from_first_message
from ..db import connect, json_dump, row_to_dict
from ..domain import AgentRunResult, ToolError, ToolEvent
from ..agent.resume_policy import should_abandon_snapshot
from ..agent.snapshots import clear_run_snapshot, load_run_snapshot
from ..agent.run_store import AgentRunStore
from ..agent.model_binding import internal_model_selection, is_bound_selection, is_legacy_selection
from ..observability.model_context import public_model_selection
from .service import (
    agent_history as _agent_history,
    attachment_context as _attachment_context,
    default_conversation_id as _default_conversation_id,
    save_chat_message as _save_chat_message,
    save_stream_result as _save_stream_result,
)
from .ag_ui import event_stream


_active_chat_runs: dict[tuple[int, int], asyncio.Task[None]] = {}


def require_conversation(conversation_id: int) -> dict[str, Any]:
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="对话不存在")
    return conversation


def _chat_run_key(conversation_id: int) -> tuple[int, int]:
    return (current_user_id() or 0, conversation_id)


async def cancel_current_agent_task(conversation_id: int | None = None) -> dict[str, Any]:
    resolved_id = conversation_id or _default_conversation_id()
    require_conversation(resolved_id)
    cancelled = False
    if AgentRunStore().request_cancel_for_conversation(resolved_id):
        cancelled = True
    active_task = _active_chat_runs.get(_chat_run_key(resolved_id))
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

    end_active_task(resolved_id)
    clear_run_snapshot(resolved_id)
    return {"cancelled": cancelled}


def _durable_run_payload(run: dict[str, Any]) -> dict[str, Any]:
    run_id = str(run["run_id"])
    tool_executions = [
        {
            "tool_call_id": item.get("tool_call_id"),
            "tool_name": item.get("tool_name"),
            "risk": item.get("risk"),
            "status": item.get("status"),
            "attempt_count": item.get("attempt_count"),
            "created_at": item.get("created_at"),
            "updated_at": item.get("updated_at"),
            "completed_at": item.get("completed_at"),
        }
        for item in AgentRunStore().list_tool_executions(run_id)
    ]
    return {
        "run_id": run_id,
        "conversation_id": run.get("conversation_id"),
        "task_id": run.get("task_id"),
        "user_message_id": run.get("user_message_id"),
        "status": run.get("status"),
        "route_kind": run.get("route_kind"),
        "round_number": run.get("round_number"),
        "model_selection": public_model_selection(run.get("model_selection")),
        "stop_reason": run.get("stop_reason"),
        "cancel_requested": bool(run.get("cancel_requested")),
        "can_resume": bool(
            run.get("status") == "interrupted" and run.get("checkpoint") is not None
        ),
        "parent_run_id": run.get("parent_run_id"),
        "resumed_by_run_id": run.get("resumed_by_run_id"),
        "steps": AgentRunStore().list_steps(run_id),
        "tool_executions": tool_executions,
        "created_at": run.get("created_at"),
        "updated_at": run.get("updated_at"),
        "completed_at": run.get("completed_at"),
    }


def current_durable_agent_run(conversation_id: int | None = None) -> dict[str, Any]:
    resolved_id = conversation_id or _default_conversation_id()
    require_conversation(resolved_id)
    run = AgentRunStore().latest_for_conversation(resolved_id)
    return {"run": _durable_run_payload(run) if run is not None else None}


def cancel_durable_agent_run(run_id: str) -> dict[str, Any]:
    store = AgentRunStore()
    run = store.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Agent run 不存在")
    if run.get("conversation_id") is not None:
        require_conversation(int(run["conversation_id"]))
    cancelled = store.request_cancel(run_id)
    refreshed = store.get_run(run_id)
    return {
        "cancelled": cancelled,
        "run": _durable_run_payload(refreshed),
    }


def require_configured_runtime(profile_id: str | None = None, *, selection: dict[str, Any] | None = None):
    """Ensure model is configured before AG-UI streaming starts.

    Missing API key must surface as HTTP 400 (not an in-stream 200 failure or 500).
    """
    try:
        if selection is not None:
            return get_agent_runtime(selection=selection)
        if profile_id is not None:
            return get_agent_runtime(profile_id)
        return get_agent_runtime()
    except ValueError as exc:
        detail = str(exc)
        if "必须先配置模型服务 API Key" in detail or "API Key" in detail:
            raise HTTPException(status_code=400, detail="必须先配置模型服务 API Key") from exc
        raise HTTPException(status_code=400, detail=detail) from exc


async def stream_chat_response(
    payload: ChatMessageIn,
    *,
    ag_ui_input: RunAgentInput,
    accept: str | None = None,
) -> StreamingResponse:
    conversation_id = payload.conversation_id or _default_conversation_id()
    conversation = require_conversation(conversation_id)
    active = _active_chat_runs.get(_chat_run_key(conversation_id))
    if active is not None and not active.done():
        raise HTTPException(status_code=409, detail="当前对话已有正在执行的任务")

    run_store = AgentRunStore()
    persisted_run = run_store.get_run(ag_ui_input.run_id)
    if persisted_run is not None and persisted_run.get("model_selection_invalid"):
        raise HTTPException(status_code=409, detail="运行的模型绑定信息损坏，无法恢复")
    if (
        persisted_run is not None
        and persisted_run.get("conversation_id") is not None
        and int(persisted_run["conversation_id"]) != conversation_id
    ):
        raise HTTPException(status_code=409, detail="runId 已属于其他对话")
    if persisted_run is not None and persisted_run.get("status") == "running":
        raise HTTPException(status_code=409, detail="该 Agent run 仍在其他执行器中运行")
    cached_execution: dict[str, Any] | None = None
    if (
        persisted_run is not None
        and persisted_run.get("result") is not None
        and persisted_run.get("user_message_id")
        and persisted_run.get("assistant_message_id")
    ):
        with connect() as conn:
            cached_user = conn.execute(
                "SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?",
                (persisted_run["user_message_id"], conversation_id),
            ).fetchone()
            cached_assistant = conn.execute(
                "SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?",
                (persisted_run["assistant_message_id"], conversation_id),
            ).fetchone()
        if cached_user is not None and cached_assistant is not None:
            cached_execution = {
                "result": persisted_run["result"],
                "user_message": row_to_dict(cached_user),
                "assistant_message": row_to_dict(cached_assistant),
            }

    recovered_user_message: dict[str, Any] | None = None
    if (
        cached_execution is None
        and persisted_run is not None
        and persisted_run.get("user_message_id")
        and (
            persisted_run.get("result") is not None
            or persisted_run.get("status") == "interrupted"
        )
    ):
        with connect() as conn:
            bound_user = conn.execute(
                "SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ?",
                (persisted_run["user_message_id"], conversation_id),
            ).fetchone()
        if bound_user is not None:
            recovered_user_message = row_to_dict(bound_user)

    trusted_routing_content = payload.content.replace("[系统可信开关：本轮允许联网搜索]", "")
    if payload.web_search:
        trusted_routing_content += "\n[系统可信开关：本轮允许联网搜索]"
    resume_snapshot = load_run_snapshot(conversation_id) if cached_execution is None else None
    abandon_snapshot = bool(resume_snapshot is not None and should_abandon_snapshot(
        payload.content, resume_snapshot, routing_text=trusted_routing_content,
    ))
    if abandon_snapshot:
        resume_snapshot = None

    runtime = None
    model_selection: dict[str, Any] = {}
    if cached_execution is None:
        persisted_selection = persisted_run.get("model_selection") if persisted_run is not None else None
        if persisted_run is not None and persisted_run.get("status") == "interrupted":
            historical_selection = persisted_selection
        elif resume_snapshot is not None:
            historical_selection = resume_snapshot.model_selection
        else:
            historical_selection = None
        if historical_selection is not None and not is_bound_selection(historical_selection) and not is_legacy_selection(historical_selection):
            raise HTTPException(status_code=409, detail="运行的模型绑定信息不完整，无法恢复")
        if is_bound_selection(historical_selection):
            runtime = require_configured_runtime(selection=historical_selection)
            model_selection = internal_model_selection(historical_selection)
        else:
            # Omitted inherits conversation; explicit null selects the account default.
            profile_id = (getattr(payload, "model_profile_id", None)
                          if "model_profile_id" in payload.model_fields_set
                          else conversation.get("model_profile_id"))
            runtime = require_configured_runtime(profile_id)
            if historical_selection is not None:
                model_selection = internal_model_selection(historical_selection)
            else:
                model_selection = internal_model_selection(getattr(runtime, "model_selection", None))
                if is_bound_selection(model_selection):
                    model_selection["selection_reason"] = (
                        "explicit_profile" if "model_profile_id" in payload.model_fields_set and profile_id is not None
                        else "conversation_profile" if profile_id is not None else "default_profile"
                    )
        if abandon_snapshot:
            clear_run_snapshot(conversation_id)

    if cached_execution is not None or recovered_user_message is not None:
        task_id = int(persisted_run.get("task_id") or 0) or None
        attachment_context, attachment_summaries, image_urls = "", [], []
        user_message = (
            cached_execution["user_message"]
            if cached_execution is not None
            else recovered_user_message
        )
        history = []
        agent_input = str(persisted_run.get("user_content") or payload.content)
    else:
        task_id = ensure_active_task(conversation_id)
        attachment_context, attachment_summaries, image_urls = _attachment_context(
            conversation_id, payload.attachment_ids, payload.vision_attachment_ids
        )
        user_payload: dict[str, Any] = {}
        if attachment_summaries:
            user_payload["attachments"] = attachment_summaries
        if payload.web_search:
            user_payload["web_search"] = True
            user_payload["web_search_mode"] = payload.web_search_mode
        agent_input = payload.content
        if attachment_context:
            agent_input += (
                "\n\n以下为用户主动上传附件的本地解析文本，请基于此内容回答：\n"
                f"{attachment_context}"
            )
        try:
            run_store.start_run(
                ag_ui_input.run_id,
                conversation_id=conversation_id,
                task_id=task_id,
                user_content=agent_input,
                model_selection=model_selection,
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        user_message = _save_chat_message(
            "user",
            payload.content,
            user_payload or None,
            conversation_id,
            task_id,
        )
        run_store.bind_messages(
            ag_ui_input.run_id,
            user_message_id=int(user_message["id"]),
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
            if cached_execution is not None:
                result = cached_execution["result"]
                await queue.put(("text_reset", {}))
                if result.content:
                    await queue.put(("text_delta", {"delta": result.content}))
                await queue.put(
                    (
                        "completed",
                        {
                            "user_message": cached_execution["user_message"],
                            "assistant_message": cached_execution["assistant_message"],
                        },
                    )
                )
                return
            result = None
            if resume_snapshot is not None:
                run_store.link_waiting_resume(
                    conversation_id,
                    ag_ui_input.run_id,
                )
            async for stream_event in runtime.run_stream(
                agent_input,
                history=history,
                conversation_id=conversation_id,
                task_id=task_id,
                image_urls=image_urls,
                routing_content=trusted_routing_content,
                web_search_mode=payload.web_search_mode,
                resume=resume_snapshot,
                run_id=ag_ui_input.run_id,
                model_selection=model_selection,
            ):
                if stream_event.type == "text_delta":
                    partial_content += stream_event.delta
                    await queue.put(("text_delta", {"delta": stream_event.delta}))
                elif stream_event.type == "reasoning_delta":
                    if stream_event.delta:
                        await queue.put(("reasoning_delta", {"delta": stream_event.delta}))
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
            if result is None:
                raise RuntimeError("Agent 流已结束，但没有返回结果")

            run_store.finish(ag_ui_input.run_id, result)
            completed = _save_stream_result(conversation_id, task_id, user_message, result)
            run_store.bind_messages(
                ag_ui_input.run_id,
                assistant_message_id=int(completed["assistant_message"]["id"]),
            )
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
                provider=str(model_selection.get("profile_id") or "legacy"),
                model_selection=model_selection,
                platform="manual",
                rounds=0,
                status="cancelled",
                error=ToolError(code="user_cancelled", message="用户已停止生成"),
                events=list(streamed_events.values()),
            )
            run_store.finish(ag_ui_input.run_id, cancelled_result)
            completed = _save_stream_result(
                conversation_id, task_id, user_message, cancelled_result
            )
            run_store.bind_messages(
                ag_ui_input.run_id,
                assistant_message_id=int(completed["assistant_message"]["id"]),
            )
            await queue.put(("cancelled", completed))
        except Exception as exc:
            failed_result = AgentRunResult(
                content="流式执行发生异常，本次任务已终止。",
                provider=str(model_selection.get("profile_id") or "legacy"),
                model_selection=model_selection,
                platform="manual",
                rounds=0,
                status="failed",
                error=ToolError(code="stream_failed", message=str(exc), retryable=True),
                events=list(streamed_events.values()),
            )
            run_store.finish(ag_ui_input.run_id, failed_result)
            completed = _save_stream_result(conversation_id, task_id, user_message, failed_result)
            run_store.bind_messages(
                ag_ui_input.run_id,
                assistant_message_id=int(completed["assistant_message"]["id"]),
            )
            await queue.put(("error", {**completed, "message": str(exc)}))
        finally:
            if _active_chat_runs.get(_chat_run_key(conversation_id)) is current_task:
                _active_chat_runs.pop(_chat_run_key(conversation_id), None)
            await queue.put(None)

    worker = asyncio.create_task(execute())
    _active_chat_runs[_chat_run_key(conversation_id)] = worker

    return StreamingResponse(
        event_stream(queue, worker, ag_ui_input, accept),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def is_chat_running(conversation_id: int) -> bool:
    task = _active_chat_runs.get(_chat_run_key(conversation_id))
    return task is not None and not task.done()

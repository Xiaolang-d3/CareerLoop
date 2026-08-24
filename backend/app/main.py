from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
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
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from .agent import get_agent_runtime
from .api import resources_router
from .api.dependencies import require_conversation
from .api.schemas import AccountUpdateIn, ChatMessageIn, LoginIn, PasswordChangeIn
from .config import get_settings
from .auth import (
    authenticate,
    avatar_path,
    captcha_svg,
    change_password,
    create_captcha,
    create_initial_user,
    current_user,
    delete_avatar,
    get_account,
    public_auth_config,
    register_user,
    save_avatar,
    update_account,
)
from .workspace import (
    current_user_id,
    ensure_workspace,
    list_user_ids,
    spawn_thread,
    use_workspace,
)
from .chat.conversations import (
    end_active_task,
    ensure_active_task,
    maybe_title_from_first_message,
)
from .db import connect, json_dump, row_to_dict, rows_to_dicts
from .database_lifecycle import (
    database_status,
    initialize_or_report,
    rebuild_database_v2,
)
from .domain import AgentRunResult, ToolError, ToolEvent
from .agent.resume_policy import should_abandon_snapshot
from .agent.snapshots import clear_run_snapshot, load_run_snapshot
from .chat.service import (
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
from .opportunities.runs import interrupt_active_runs
from .jobs.evaluations import interrupt_active_evaluations
from .profile.candidate_core import ensure_resume_knowledge_indexed
from .version import APP_VERSION


BACKEND_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIST_DIR = BACKEND_DIR.parent / "frontend" / "dist"

_settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    startup()
    yield

# API docs describe every route, so they stay closed unless explicitly enabled.
app = FastAPI(
    title="CareerLoop API",
    version=APP_VERSION,
    docs_url="/docs" if _settings.api_docs_enabled else None,
    redoc_url="/redoc" if _settings.api_docs_enabled else None,
    openapi_url="/openapi.json" if _settings.api_docs_enabled else None,
    lifespan=lifespan,
)

_active_chat_runs: dict[tuple[int, int], asyncio.Task[None]] = {}

_OPEN_AUTH_PATHS = {
    "/health",
    "/auth/config",
    "/auth/captcha",
    "/auth/bootstrap",
    "/auth/login",
    "/auth/register",
}
_DOC_PATHS = {"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}
# Docs are protected by token when disabled, so they stay out of the open list.
_REQUIRE_LOGIN_WHITELIST = _OPEN_AUTH_PATHS | (_DOC_PATHS if _settings.api_docs_enabled else set())
_PUBLIC_FRONTEND_FILES = {"/favicon.ico", "/vite.svg", "/careerloop-mark-v2.png"}
_STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"


def static_asset_cache_control(path: str) -> str | None:
    """Return the safe long-lived cache policy for Vite's content-hashed assets."""
    return _STATIC_ASSET_CACHE_CONTROL if path.startswith("/assets/") else None


@app.middleware("http")
async def require_login(request: Request, call_next: Any) -> Any:
    path = request.url.path
    is_frontend_asset = path == "/" or path.startswith("/assets/") or path in _PUBLIC_FRONTEND_FILES
    if request.method == "OPTIONS" or is_frontend_asset or path in _REQUIRE_LOGIN_WHITELIST or path.startswith("/auth/captcha/"):
        response = await call_next(request)
        cache_control = static_asset_cache_control(path)
        if cache_control and response.status_code == 200:
            response.headers["Cache-Control"] = cache_control
        return response
    try:
        user = current_user(request.headers.get("Authorization"))
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    root = ensure_workspace(int(user["id"]))
    with use_workspace(int(user["id"]), root):
        return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resources_router)


@app.get("/auth/config")
def get_auth_config() -> dict[str, bool]:
    return public_auth_config()


@app.get("/auth/captcha")
def get_captcha() -> dict[str, str]:
    return create_captcha()


@app.get("/auth/captcha/{captcha_id}.svg")
def get_captcha_image(captcha_id: str) -> Response:
    image = captcha_svg(captcha_id)
    if image is None:
        raise HTTPException(status_code=404, detail="验证码已过期")
    return Response(content=image, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@app.post("/auth/login")
def login(payload: LoginIn, request: Request) -> dict[str, Any]:
    token = authenticate(
        payload.email,
        payload.password,
        payload.captcha_id,
        payload.captcha_code,
        client=request.client.host if request.client else None,
    )
    user = current_user(f"Bearer {token}")
    return {"access_token": token, "token_type": "bearer", "user": get_account(int(user["id"]))}


@app.post("/auth/register")
def register(payload: LoginIn) -> dict[str, Any]:
    token = register_user(payload.email, payload.password, payload.captcha_id, payload.captcha_code)
    user = current_user(f"Bearer {token}")
    return {"access_token": token, "token_type": "bearer", "user": get_account(int(user["id"]))}


@app.post("/auth/bootstrap")
def bootstrap_admin(payload: LoginIn) -> dict[str, Any]:
    token = create_initial_user(payload.email, payload.password, payload.captcha_id, payload.captcha_code)
    user = current_user(f"Bearer {token}")
    return {"access_token": token, "token_type": "bearer", "user": get_account(int(user["id"]))}


@app.get("/auth/me")
def get_current_user(request: Request) -> dict[str, Any]:
    user = current_user(request.headers.get("Authorization"))
    return {"user": get_account(int(user["id"]))}


@app.patch("/auth/me")
def patch_current_user(payload: AccountUpdateIn, request: Request) -> dict[str, Any]:
    user = current_user(request.headers.get("Authorization"))
    return {"user": update_account(int(user["id"]), payload.display_name)}


@app.post("/auth/me/password")
def change_current_password(payload: PasswordChangeIn, request: Request) -> dict[str, Any]:
    user = current_user(request.headers.get("Authorization"))
    token = change_password(int(user["id"]), payload.current_password, payload.new_password)
    refreshed = current_user(f"Bearer {token}")
    return {"access_token": token, "token_type": "bearer", "user": get_account(int(refreshed["id"]))}


@app.get("/auth/me/avatar")
def get_current_avatar(request: Request) -> Response:
    user = current_user(request.headers.get("Authorization"))
    path = avatar_path(int(user["id"]))
    if path is None:
        raise HTTPException(status_code=404, detail="还没有上传头像")
    return Response(content=path.read_bytes(), media_type="image/jpeg", headers={"Cache-Control": "private, no-cache"})


@app.post("/auth/me/avatar")
async def upload_current_avatar(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
    user = current_user(request.headers.get("Authorization"))
    try:
        content = await file.read()
        account = save_avatar(int(user["id"]), file.filename or "avatar.jpg", content)
    finally:
        await file.close()
    return {"user": account}


@app.delete("/auth/me/avatar")
def remove_current_avatar(request: Request) -> dict[str, Any]:
    user = current_user(request.headers.get("Authorization"))
    return {"user": delete_avatar(int(user["id"]))}


def _chat_run_key(conversation_id: int) -> tuple[int, int]:
    return (current_user_id() or 0, conversation_id)


def _startup_workspace(user_id: int, root: Path) -> None:
    with use_workspace(user_id, root):
        interrupt_active_runs()
        interrupt_active_evaluations()
        try:
            ensure_resume_knowledge_indexed()
        except Exception:
            pass


def startup() -> None:
    state = initialize_or_report()
    if state["status"] != "ready":
        return
    user_ids = list_user_ids()
    if not user_ids:
        interrupt_active_runs()
        interrupt_active_evaluations()
        return
    for user_id in user_ids:
        root = ensure_workspace(user_id)
        _startup_workspace(user_id, root)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/system/database-status")
def get_database_status() -> dict[str, Any]:
    return database_status()


@app.post("/system/database-rebuild")
def rebuild_database(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return rebuild_database_v2(str(payload.get("confirmation") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


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
    active = _active_chat_runs.get(_chat_run_key(resolved_id))
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
    clear_run_snapshot(resolved_id)
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

        conn.execute(
            """
            UPDATE workflow_nodes
            SET status = 'pending', detail = '上一任务已由用户结束', updated_at = CURRENT_TIMESTAMP
            WHERE status IN ('running', 'blocked') AND run_id = (
                SELECT id FROM workflow_runs WHERE name = 'default' ORDER BY id DESC LIMIT 1
            )
            """,
        )
    end_active_task(resolved_id)
    clear_run_snapshot(resolved_id)
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
    active = _active_chat_runs.get(_chat_run_key(conversation_id))
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
            # Profile interview intent is no longer keyword-matched here: the
            # interview is exposed as tools (start/record/pause) and the model
            # decides, with an active session admitted via stored state.
            if _is_workflow_status_query(payload.content):
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
                resume_snapshot = load_run_snapshot(conversation_id)
                if resume_snapshot is not None and should_abandon_snapshot(
                    payload.content,
                    resume_snapshot,
                    routing_text=trusted_routing_content,
                ):
                    clear_run_snapshot(conversation_id)
                    resume_snapshot = None
                async for stream_event in get_agent_runtime().run_stream(
                    agent_input,
                    history=history,
                    conversation_id=conversation_id,
                    task_id=task_id,
                    image_urls=image_urls,
                    routing_content=trusted_routing_content,
                    resume=resume_snapshot,
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
            if _active_chat_runs.get(_chat_run_key(conversation_id)) is current_task:
                _active_chat_runs.pop(_chat_run_key(conversation_id), None)
            await queue.put(None)

    worker = asyncio.create_task(execute())
    _active_chat_runs[_chat_run_key(conversation_id)] = worker

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
                    yield encode(CustomEvent(name="careerloop.user_message", value=data["user_message"]))
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
                        yield encode(CustomEvent(name="careerloop.agent_event", value=tool_event))
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
                    yield encode(CustomEvent(name="careerloop.agent_event", value=tool_event))
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
                        "careerLoop": {
                            "status": status,
                            "userMessage": data["user_message"],
                            "assistantMessage": data["assistant_message"],
                        },
                    }
                    yield encode(StateSnapshotEvent(snapshot=snapshot))
                    if event_name == "cancelled":
                        yield encode(CustomEvent(name="careerloop.cancelled", value={"status": status}))
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


# Production mode uses one origin: FastAPI serves the built SPA and its API.
# This lets an HTTPS tunnel expose a single protected URL without public :8000.
if FRONTEND_DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="frontend")

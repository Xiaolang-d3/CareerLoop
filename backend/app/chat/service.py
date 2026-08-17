from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from ..agent.settings import get_agent_settings
from ..agent.snapshots import clear_run_snapshot, save_run_snapshot
from ..attachments.service import get_attachment, prepare_attachment_vision_url
from .conversations import create_conversation, list_conversations
from ..db import connect, json_dump, row_to_dict
from ..domain import AgentMessage, AgentRunResult, ToolEvent
from ..workflow.engine import ensure_default_run, record_events, refresh_workflow_status
from ..workflow.stages import STAGE_TITLES, stage_for_route, stage_for_tool


def save_chat_message(
    role: str,
    content: str,
    payload: dict[str, Any] | None = None,
    conversation_id: int | None = None,
    task_id: int | None = None,
) -> dict[str, Any]:
    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO chat_messages (role, content, payload_json, conversation_id, task_id)
            VALUES (?, ?, ?, ?, ?)
            """,
            (role, content, json_dump(payload or {}), conversation_id, task_id),
        )
        row = conn.execute(
            "SELECT * FROM chat_messages WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return row_to_dict(row)


def workflow_summary(status: dict[str, Any]) -> str:
    nodes = status["nodes"]
    total = len(nodes)
    touched = [node["title"] for node in nodes if node["status"] != "pending"]
    pending_titles = [node["title"] for node in nodes if node["status"] == "pending"]
    if not touched:
        return f"当前工作流尚未触达任何阶段。待处理：{'、'.join(pending_titles)}。"
    if pending_titles:
        return (
            f"当前工作流已触达 {len(touched)}/{total} 个阶段：{'、'.join(touched)}。"
            f"尚未触达：{'、'.join(pending_titles)}。"
        )
    return f"当前工作流已触达 {total}/{total} 个阶段：{'、'.join(touched)}。"


def is_workflow_status_query(content: str) -> bool:
    text = " ".join(content.lower().split())
    if any(
        marker in text
        for marker in (
            "更新投递状态",
            "记录已投递",
            "记录已联系",
            "记录面试",
            "记录被拒",
            "标记已投递",
        )
    ):
        return False
    return text in {"状态", "进度"} or any(
        marker in text
        for marker in (
            "查看状态",
            "查看当前状态",
            "查看进度",
            "查看当前进度",
            "当前进度",
            "任务进度",
            "进行到哪",
            "到哪了",
        )
    )


def local_answer_result(
    content: str,
    reasoning_summary: str,
    route: str,
) -> AgentRunResult:
    """为确定性的本地回答附加与模型回答一致的可审计轨迹。"""
    return AgentRunResult(
        content=content,
        provider="local_router",
        platform="manual",
        rounds=0,
        events=[
            ToolEvent(
                round=0,
                tool_call_id=f"local-thinking-{route}",
                tool_name="agent_thinking",
                status="done",
                message=reasoning_summary,
                data={"route": route, "allowed_tools": []},
            )
        ],
    )


def default_conversation_id() -> int:
    conversations = list_conversations()
    if conversations:
        return conversations[0]["id"]
    return create_conversation()["id"]


def agent_history(conversation_id: int, before_message_id: int) -> list[AgentMessage]:
    settings = get_agent_settings()
    if not settings["conversation_memory_enabled"]:
        return []
    limit = settings["context_message_limit"]
    with connect() as conn:
        conversation = conn.execute(
            "SELECT summary, context_cutoff_message_id FROM conversations WHERE id = ?",
            (conversation_id,),
        ).fetchone()
        cutoff = conversation["context_cutoff_message_id"] if conversation else 0
        rows = conn.execute(
            """
            SELECT role, content FROM chat_messages
            WHERE conversation_id = ? AND id < ? AND id > ?
              AND role IN ('user', 'assistant')
            ORDER BY id DESC LIMIT ?
            """,
            (conversation_id, before_message_id, cutoff, limit),
        ).fetchall()
    history: list[AgentMessage] = []
    if settings["summary_enabled"] and conversation and conversation["summary"]:
        history.append(
            AgentMessage(
                role="system",
                content=f"当前对话的早期任务摘要：{conversation['summary']}",
            )
        )
    history.extend(
        AgentMessage(role=row["role"], content=row["content"])
        for row in reversed(rows)
    )
    return history


def refresh_conversation_summary(conversation_id: int) -> None:
    """为超出最近上下文窗口的消息维护一份小型本地摘要。"""
    settings = get_agent_settings()
    if not settings["conversation_memory_enabled"] or not settings["summary_enabled"]:
        with connect() as conn:
            conn.execute(
                "UPDATE conversations SET summary = '' WHERE id = ?",
                (conversation_id,),
            )
        return
    limit = settings["context_message_limit"]
    with connect() as conn:
        conversation = conn.execute(
            "SELECT context_cutoff_message_id FROM conversations WHERE id = ?",
            (conversation_id,),
        ).fetchone()
        cutoff = conversation["context_cutoff_message_id"] if conversation else 0
        rows = conn.execute(
            """
            SELECT role, content FROM chat_messages
            WHERE conversation_id = ? AND id > ? AND role IN ('user', 'assistant')
            ORDER BY id DESC
            """,
            (conversation_id, cutoff),
        ).fetchall()
        older = list(reversed(rows[limit : limit + 20]))
        summary = "\n".join(
            f"{'用户目标' if row['role'] == 'user' else 'Agent结论'}：{' '.join(row['content'].split())[:180]}"
            for row in older
        )
        conn.execute(
            "UPDATE conversations SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (summary[:2400], conversation_id),
        )


def attachment_context(
    conversation_id: int,
    attachment_ids: list[str],
    vision_attachment_ids: list[str],
) -> tuple[str, list[dict[str, Any]], list[str]]:
    blocks: list[str] = []
    summaries: list[dict[str, Any]] = []
    image_urls: list[str] = []
    requested_vision_ids = set(vision_attachment_ids)
    seen_ids: set[str] = set()
    for attachment_id in dict.fromkeys(attachment_ids):
        attachment = get_attachment(attachment_id)
        if attachment is None or attachment["conversation_id"] != conversation_id:
            raise HTTPException(status_code=422, detail="附件不存在或不属于当前对话")
        seen_ids.add(attachment_id)
        if attachment["parse_status"] != "parsed":
            raise HTTPException(
                status_code=422,
                detail=f"附件“{attachment['original_filename']}”尚未完成本地解析",
            )
        wants_vision = attachment_id in requested_vision_ids
        if attachment["kind"] == "job_screenshot" and not wants_vision:
            raise HTTPException(
                status_code=422,
                detail=f"岗位截图“{attachment['original_filename']}”不会提取文本，请勾选“模型看图”后发送",
            )
        if wants_vision:
            try:
                image_urls.append(prepare_attachment_vision_url(attachment_id))
            except (RuntimeError, ValueError) as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        if attachment["kind"] == "resume":
            text = attachment["redacted_text"]
            if not text:
                raise HTTPException(
                    status_code=422,
                    detail=f"附件“{attachment['original_filename']}”没有可用文本",
                )
            blocks.append(f"[脱敏简历：{attachment['original_filename']}]\n{text}")
        else:
            blocks.append(f"[岗位截图：{attachment['original_filename']}，由模型直接查看]")
        summaries.append(
            {
                "id": attachment["id"],
                "kind": attachment["kind"],
                "original_filename": attachment["original_filename"],
                "parse_status": attachment["parse_status"],
                "vision_status": (
                    "consented"
                    if wants_vision
                    else attachment.get("vision_status", "not_requested")
                ),
                "metadata": attachment.get("metadata", {}),
            }
        )
    if requested_vision_ids.difference(seen_ids):
        raise HTTPException(status_code=422, detail="图片直传附件必须同时随消息发送")
    return "\n\n".join(blocks), summaries, image_urls


def _result_route(result: AgentRunResult) -> str | None:
    """取出本轮 route.kind。

    runtime 与 local_answer_result 都把它放在首个 agent_thinking 事件的
    data["route"]（runtime.py:115、本文件 local_answer_result）。AgentPlan.route
    只在生成了计划时存在，因此仅作兜底。
    """
    for event in result.events:
        if event.tool_name == "agent_thinking":
            route = event.data.get("route")
            if isinstance(route, str) and route:
                return route
            break
    if result.plan is not None:
        return result.plan.route
    return None


def _primary_stage(result: AgentRunResult) -> str | None:
    return stage_for_route(_result_route(result))


def save_stream_result(
    conversation_id: int,
    task_id: int,
    user_message: dict[str, Any],
    result: AgentRunResult,
) -> dict[str, Any]:
    run_id = ensure_default_run(conversation_id)
    primary_stage = _primary_stage(result)

    # (event_type, message, node_id, payload)
    pending_events: list[tuple[str, str, str, dict[str, Any] | None]] = []

    if primary_stage is not None:
        pending_events.append(
            (
                "stage_engaged",
                f"本轮进入阶段：{STAGE_TITLES.get(primary_stage, primary_stage)}",
                primary_stage,
                {"route": _result_route(result), "conversation_id": conversation_id},
            )
        )

    if result.plan is not None:
        pending_events.append(
            (
                "agent_plan_created",
                f"已生成 {len(result.plan.steps)} 步执行计划：{result.plan.goal}",
                primary_stage or "",
                result.plan.model_dump(mode="json"),
            )
        )

    for event in result.events:
        if event.status != "done":
            continue
        # stage_for_tool 只认真实工具名，runtime 的合成事件（agent_thinking 等）自动落空。
        stage_id = stage_for_tool(event.tool_name)
        if stage_id is None:
            continue
        pending_events.append(
            (
                "tool_completed",
                event.message,
                stage_id,
                {
                    "tool_name": event.tool_name,
                    "tool_call_id": event.tool_call_id,
                    "conversation_id": conversation_id,
                },
            )
        )

    record_events(run_id, pending_events)
    if result.status == "waiting_user" and result.snapshot is not None:
        save_run_snapshot(conversation_id, result.snapshot)
    elif result.provider != "local_router":
        clear_run_snapshot(conversation_id)
    workflow = refresh_workflow_status(conversation_id)
    assistant_message = save_chat_message(
        "assistant",
        result.content,
        {"workflow": workflow, "agent": result.model_dump(mode="json", exclude={"snapshot"})},
        conversation_id,
        task_id,
    )
    refresh_conversation_summary(conversation_id)
    return {
        "user_message": user_message,
        "assistant_message": assistant_message,
        "workflow": workflow,
    }

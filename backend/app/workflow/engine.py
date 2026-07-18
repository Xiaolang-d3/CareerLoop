from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..db import connect, json_dump, row_to_dict, rows_to_dicts


NODE_DEFS = [
    ("user_goal", "用户目标"),
    ("agent_planning", "Agent 规划"),
    ("import_job", "导入当前岗位"),
    ("analyze_jobs", "分析岗位"),
    ("confirm_apply", "等待确认"),
    ("applications", "投递记录"),
]


class WorkflowState(TypedDict, total=False):
    run_id: int
    conversation_id: int | None
    browser: dict[str, Any]
    counts: dict[str, int]
    nodes: list[dict[str, Any]]
    status: str


def ensure_default_run(conversation_id: int | None = None) -> int:
    run_name = f"conversation-{conversation_id}" if conversation_id is not None else "default"
    with connect() as conn:
        row = conn.execute(
            "SELECT id FROM workflow_runs WHERE name = ? ORDER BY id DESC LIMIT 1",
            (run_name,),
        ).fetchone()
        if row is None:
            cursor = conn.execute(
                "INSERT INTO workflow_runs (name, status) VALUES (?, ?)",
                (run_name, "in_progress"),
            )
            run_id = cursor.lastrowid
            _ensure_nodes(conn, run_id)
            conn.execute(
                """
                INSERT INTO workflow_events (run_id, event_type, message)
                VALUES (?, ?, ?)
                """,
                (run_id, "run_created", "默认工作流已创建"),
            )
            return run_id

        run_id = row["id"]
        _ensure_nodes(conn, run_id)
        return run_id


def _ensure_nodes(conn, run_id: int) -> None:
    for position, (node_id, title) in enumerate(NODE_DEFS, start=1):
        conn.execute(
            """
            INSERT INTO workflow_nodes (run_id, node_id, title, position)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(run_id, node_id) DO UPDATE SET
                title = excluded.title,
                position = excluded.position,
                updated_at = CURRENT_TIMESTAMP
            """,
            (run_id, node_id, title, position),
        )


def _counts(conversation_id: int | None = None) -> dict[str, int]:
    with connect() as conn:
        if conversation_id is None:
            job_filter = ""
            params: tuple[int, ...] = ()
        else:
            job_filter = " WHERE id IN (SELECT job_id FROM conversation_jobs WHERE conversation_id = ?)"
            params = (conversation_id,)
        return {
            "profiles": conn.execute("SELECT COUNT(*) AS count FROM profiles").fetchone()["count"],
            "jobs": conn.execute(f"SELECT COUNT(*) AS count FROM jobs{job_filter}", params).fetchone()["count"],
            "matches": conn.execute(
                "SELECT COUNT(*) AS count FROM match_results" + (
                    " WHERE job_id IN (SELECT job_id FROM conversation_jobs WHERE conversation_id = ?)" if conversation_id is not None else ""
                ), params,
            ).fetchone()["count"],
            "drafts": conn.execute(
                "SELECT COUNT(*) AS count FROM messages WHERE status = 'draft'" + (
                    " AND job_id IN (SELECT job_id FROM conversation_jobs WHERE conversation_id = ?)" if conversation_id is not None else ""
                ), params,
            ).fetchone()["count"],
            "queued_applications": conn.execute(
                "SELECT COUNT(*) AS count FROM applications WHERE status = 'queued'" + (
                    " AND job_id IN (SELECT job_id FROM conversation_jobs WHERE conversation_id = ?)" if conversation_id is not None else ""
                ), params,
            ).fetchone()["count"],
            "progressed_applications": conn.execute(
                "SELECT COUNT(*) AS count FROM applications WHERE status != 'queued'" + (
                    " AND job_id IN (SELECT job_id FROM conversation_jobs WHERE conversation_id = ?)" if conversation_id is not None else ""
                ), params,
            ).fetchone()["count"],
            "applications": conn.execute(
                "SELECT COUNT(*) AS count FROM applications" + (
                    " WHERE job_id IN (SELECT job_id FROM conversation_jobs WHERE conversation_id = ?)" if conversation_id is not None else ""
                ), params,
            ).fetchone()["count"],
        }


def _set_node(run_id: int, node_id: str, status: str, detail: str) -> None:
    completed_expr = "CURRENT_TIMESTAMP" if status == "done" else "NULL"
    started_expr = "COALESCE(started_at, CURRENT_TIMESTAMP)" if status in {"done", "running"} else "started_at"
    with connect() as conn:
        conn.execute(
            f"""
            UPDATE workflow_nodes
            SET status = ?,
                detail = ?,
                started_at = {started_expr},
                completed_at = {completed_expr},
                updated_at = CURRENT_TIMESTAMP
            WHERE run_id = ? AND node_id = ?
            """,
            (status, detail, run_id, node_id),
        )


def record_event(run_id: int, event_type: str, message: str, node_id: str = "", payload: dict[str, Any] | None = None) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO workflow_events (run_id, node_id, event_type, message, payload_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (run_id, node_id, event_type, message, json_dump(payload or {})),
        )


def _read_runtime_state(state: WorkflowState) -> WorkflowState:
    return {
        **state,
        "browser": {"mode": "user_controlled", "auth": {"status": "user_managed"}},
        "counts": _counts(state.get("conversation_id")),
    }


def _sync_nodes(state: WorkflowState) -> WorkflowState:
    run_id = state["run_id"]
    counts = state["counts"]
    with connect() as conn:
        conversation_id = state.get("conversation_id")
        if conversation_id is None:
            user_messages = conn.execute("SELECT COUNT(*) AS count FROM chat_messages WHERE role = 'user'").fetchone()["count"]
        else:
            user_messages = conn.execute(
                "SELECT COUNT(*) AS count FROM chat_messages WHERE role = 'user' AND conversation_id = ?",
                (conversation_id,),
            ).fetchone()["count"]
        plan_events = conn.execute(
            "SELECT COUNT(*) AS count FROM workflow_events WHERE run_id = ? AND event_type = 'agent_plan_created'",
            (run_id,),
        ).fetchone()["count"]

    _set_node(
        run_id,
        "user_goal",
        "done" if user_messages > 0 else "pending",
        f"{user_messages} 条用户指令",
    )
    _set_node(
        run_id,
        "agent_planning",
        "done" if plan_events > 0 else "pending",
        f"{plan_events} 个结构化执行计划" if plan_events > 0 else "复杂任务尚未生成执行计划",
    )
    _set_node(
        run_id,
        "import_job",
        "done" if counts["jobs"] > 0 else "pending",
        f"当前对话关联 {counts['jobs']} 个真实岗位",
    )
    _set_node(
        run_id,
        "analyze_jobs",
        "done" if counts["matches"] > 0 else "pending",
        f"{counts['matches']} 个岗位已有匹配分析" if counts["matches"] > 0 else "等待岗位分析",
    )
    _set_node(
        run_id,
        "confirm_apply",
        "running" if counts["queued_applications"] > 0 else "pending",
        (
            f"{counts['queued_applications']} 个岗位在本地待投递队列，等待用户确认"
            if counts["queued_applications"] > 0
            else "等待用户选择并确认待投岗位"
        ),
    )
    _set_node(
        run_id,
        "applications",
        "done" if counts["progressed_applications"] > 0 else "pending",
        f"{counts['progressed_applications']} 条已推进求职记录",
    )

    return state


def _finalize_run(state: WorkflowState) -> WorkflowState:
    run_id = state["run_id"]
    with connect() as conn:
        pending_count = conn.execute(
            "SELECT COUNT(*) AS count FROM workflow_nodes WHERE run_id = ? AND status != ?",
            (run_id, "done"),
        ).fetchone()["count"]
        status = "done" if pending_count == 0 else "in_progress"
        conn.execute(
            """
            UPDATE workflow_runs
            SET status = ?, state_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (status, json_dump(state), run_id),
        )
    return {**state, "status": status}


def _build_graph():
    graph = StateGraph(WorkflowState)
    graph.add_node("read_runtime_state", _read_runtime_state)
    graph.add_node("sync_nodes", _sync_nodes)
    graph.add_node("finalize_run", _finalize_run)
    graph.add_edge(START, "read_runtime_state")
    graph.add_edge("read_runtime_state", "sync_nodes")
    graph.add_edge("sync_nodes", "finalize_run")
    graph.add_edge("finalize_run", END)
    return graph.compile()


workflow_graph = _build_graph()


def refresh_workflow_status(conversation_id: int | None = None) -> dict[str, Any]:
    run_id = ensure_default_run(conversation_id)
    state = workflow_graph.invoke({"run_id": run_id, "conversation_id": conversation_id})
    with connect() as conn:
        run = row_to_dict(conn.execute("SELECT * FROM workflow_runs WHERE id = ?", (run_id,)).fetchone())
        nodes = rows_to_dicts(
            conn.execute(
                f"""
                SELECT node_id AS id, title, status, detail, position, updated_at
                FROM workflow_nodes
                WHERE run_id = ? AND node_id IN ({','.join('?' for _ in NODE_DEFS)})
                ORDER BY position ASC
                """,
                (run_id, *(node_id for node_id, _ in NODE_DEFS)),
            ).fetchall()
        )
        events = rows_to_dicts(
            conn.execute(
                "SELECT id, node_id, event_type, message, payload_json, created_at FROM workflow_events WHERE run_id = ? ORDER BY id DESC LIMIT 20",
                (run_id,),
            ).fetchall()
        )

    return {
        "run": run,
        "status": state["status"],
        "counts": state["counts"],
        "nodes": nodes,
        "events": events,
    }

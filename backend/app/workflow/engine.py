from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..db import connect, json_dump, row_to_dict, rows_to_dicts


NODE_DEFS = [
    ("user_goal", "用户目标"),
    ("agent_planning", "Agent 规划"),
    ("jd_analysis", "JD 与简历分析"),
    ("resume_evidence", "简历证据检索"),
    ("tailored_resume_content", "高匹配简历内容"),
    ("interview_advice", "面试建议"),
    ("company_research", "公司公开信息研究"),
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
        run_name = f"conversation-{conversation_id}" if conversation_id is not None else "default"
        run = conn.execute(
            "SELECT id FROM workflow_runs WHERE name = ? ORDER BY id DESC LIMIT 1",
            (run_name,),
        ).fetchone()
        run_id = run["id"] if run else -1
        return {
            "profiles": conn.execute("SELECT COUNT(*) AS count FROM profiles").fetchone()["count"],
            "jd_analyses": conn.execute(
                "SELECT COUNT(*) AS count FROM workflow_events WHERE run_id = ? AND node_id = 'jd_analysis' AND event_type = 'tool_completed'",
                (run_id,),
            ).fetchone()["count"],
            "resume_evidence_searches": conn.execute(
                "SELECT COUNT(*) AS count FROM workflow_events WHERE run_id = ? AND node_id = 'resume_evidence' AND event_type = 'tool_completed'",
                (run_id,),
            ).fetchone()["count"],
            "tailored_resume_generations": conn.execute(
                "SELECT COUNT(*) AS count FROM workflow_events WHERE run_id = ? AND node_id = 'tailored_resume_content' AND event_type = 'tool_completed'",
                (run_id,),
            ).fetchone()["count"],
            "interview_advice_generations": conn.execute(
                "SELECT COUNT(*) AS count FROM workflow_events WHERE run_id = ? AND node_id = 'interview_advice' AND event_type = 'tool_completed'",
                (run_id,),
            ).fetchone()["count"],
            "company_researches": conn.execute(
                "SELECT COUNT(*) AS count FROM workflow_events WHERE run_id = ? AND node_id = 'company_research' AND event_type = 'tool_completed'",
                (run_id,),
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
        "jd_analysis",
        "done" if counts["jd_analyses"] > 0 else "pending",
        f"已完成 {counts['jd_analyses']} 次 JD 与简历分析" if counts["jd_analyses"] > 0 else "等待用户提供 JD",
    )
    _set_node(
        run_id,
        "resume_evidence",
        "done" if counts["resume_evidence_searches"] > 0 else "pending",
        (
            f"已完成 {counts['resume_evidence_searches']} 次简历证据检索"
            if counts["resume_evidence_searches"] > 0
            else "按任务需要检索简历经历"
        ),
    )
    _set_node(
        run_id,
        "tailored_resume_content",
        "done" if counts["tailored_resume_generations"] > 0 else "pending",
        (
            f"已完成 {counts['tailored_resume_generations']} 次高匹配简历内容生成"
            if counts["tailored_resume_generations"] > 0
            else "等待用户提出简历定制要求"
        ),
    )
    _set_node(
        run_id,
        "interview_advice",
        "done" if counts["interview_advice_generations"] > 0 else "pending",
        (
            f"已完成 {counts['interview_advice_generations']} 次面试建议生成"
            if counts["interview_advice_generations"] > 0
            else "等待用户提出面试准备要求"
        ),
    )
    _set_node(
        run_id,
        "company_research",
        "done" if counts["company_researches"] > 0 else "pending",
        (
            f"已完成 {counts['company_researches']} 次公司公开信息研究"
            if counts["company_researches"] > 0
            else "等待用户指定要研究的公司"
        ),
    )
    return state


def _finalize_run(state: WorkflowState) -> WorkflowState:
    run_id = state["run_id"]
    with connect() as conn:
        pending_count = conn.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM workflow_nodes
            WHERE run_id = ?
              AND status != ?
              AND node_id IN ({','.join('?' for _ in NODE_DEFS)})
            """,
            (run_id, "done", *(node_id for node_id, _ in NODE_DEFS)),
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

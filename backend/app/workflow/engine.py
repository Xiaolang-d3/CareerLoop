from __future__ import annotations

import sqlite3
from typing import Any

from ..db import connect, json_dump, row_to_dict, rows_to_dicts
from .stages import LEGACY_COUNT_KEYS, STAGE_DEFS


def _run_name(conversation_id: int | None) -> str:
    return f"conversation-{conversation_id}" if conversation_id is not None else "default"


def _ensure_run(conn: sqlite3.Connection, conversation_id: int | None) -> int:
    run_name = _run_name(conversation_id)
    row = conn.execute(
        "SELECT id FROM workflow_runs WHERE name = ? ORDER BY id DESC LIMIT 1",
        (run_name,),
    ).fetchone()
    if row is not None:
        _ensure_nodes(conn, row["id"])
        return row["id"]

    cursor = conn.execute(
        "INSERT INTO workflow_runs (name, status) VALUES (?, ?)",
        (run_name, "in_progress"),
    )
    run_id = cursor.lastrowid
    _ensure_nodes(conn, run_id)
    conn.execute(
        "INSERT INTO workflow_events (run_id, event_type, message) VALUES (?, ?, ?)",
        (run_id, "run_created", "默认工作流已创建"),
    )
    return run_id


def _ensure_nodes(conn: sqlite3.Connection, run_id: int) -> None:
    conn.executemany(
        """
        INSERT INTO workflow_nodes (run_id, node_id, title, position)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(run_id, node_id) DO UPDATE SET
            title = excluded.title,
            position = excluded.position,
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (run_id, stage_id, title, position)
            for position, (stage_id, title, _) in enumerate(STAGE_DEFS, start=1)
        ],
    )


def ensure_default_run(conversation_id: int | None = None) -> int:
    with connect() as conn:
        return _ensure_run(conn, conversation_id)


def _stage_counts(conn: sqlite3.Connection, run_id: int) -> dict[str, int]:
    """每个阶段累计完成的工具调用次数，一条 GROUP BY 查询取代逐阶段子查询。"""
    counts = {stage_id: 0 for stage_id, _, _ in STAGE_DEFS}
    rows = conn.execute(
        """
        SELECT node_id, COUNT(*) AS count
        FROM workflow_events
        WHERE run_id = ? AND event_type = 'tool_completed' AND node_id != ''
        GROUP BY node_id
        """,
        (run_id,),
    ).fetchall()
    for row in rows:
        if row["node_id"] in counts:
            counts[row["node_id"]] = row["count"]
    return counts


def _legacy_counts(conn: sqlite3.Connection, stage_counts: dict[str, int]) -> dict[str, int]:
    """派生旧响应键，保持既有前端与 e2e mock 可用。"""
    counts = {
        legacy_key: stage_counts.get(stage_id, 0)
        for legacy_key, stage_id in LEGACY_COUNT_KEYS.items()
    }
    counts["profiles"] = conn.execute(
        "SELECT COUNT(*) AS count FROM profiles"
    ).fetchone()["count"]
    return counts


def _engaged_stages(conn: sqlite3.Connection, run_id: int) -> set[str]:
    """被本会话真正触达过的阶段：工具完成或路由命中都算。"""
    rows = conn.execute(
        """
        SELECT DISTINCT node_id
        FROM workflow_events
        WHERE run_id = ?
          AND node_id != ''
          AND event_type IN ('tool_completed', 'stage_engaged')
        """,
        (run_id,),
    ).fetchall()
    return {row["node_id"] for row in rows}


def _sync_nodes(
    conn: sqlite3.Connection,
    run_id: int,
    stage_counts: dict[str, int],
    engaged: set[str],
) -> None:
    updates = []
    for stage_id, _, hint in STAGE_DEFS:
        count = stage_counts.get(stage_id, 0)
        if count > 0:
            status = "done"
            detail = f"已完成 {count} 次操作"
        elif stage_id in engaged:
            status = "running"
            detail = "已进入该阶段，尚未产出结果"
        else:
            status = "pending"
            detail = hint
        updates.append((status, detail, status in {"done", "running"}, status == "done", run_id, stage_id))

    conn.executemany(
        """
        UPDATE workflow_nodes
        SET status = ?,
            detail = ?,
            started_at = CASE WHEN ? THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
            completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
        WHERE run_id = ? AND node_id = ?
        """,
        updates,
    )


def _finalize_run(
    conn: sqlite3.Connection,
    run_id: int,
    state: dict[str, Any],
) -> str:
    placeholders = ",".join("?" for _ in STAGE_DEFS)
    pending = conn.execute(
        f"""
        SELECT COUNT(*) AS count
        FROM workflow_nodes
        WHERE run_id = ? AND status != 'done' AND node_id IN ({placeholders})
        """,
        (run_id, *(stage_id for stage_id, _, _ in STAGE_DEFS)),
    ).fetchone()["count"]
    status = "done" if pending == 0 else "in_progress"
    conn.execute(
        """
        UPDATE workflow_runs
        SET status = ?, state_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (status, json_dump({**state, "status": status}), run_id),
    )
    return status


def record_events(
    run_id: int,
    events: list[tuple[str, str, str, dict[str, Any] | None]],
) -> None:
    """批量写入 (event_type, message, node_id, payload)，避免逐条开连接。"""
    if not events:
        return
    with connect() as conn:
        conn.executemany(
            """
            INSERT INTO workflow_events (run_id, node_id, event_type, message, payload_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (run_id, node_id, event_type, message, json_dump(payload or {}))
                for event_type, message, node_id, payload in events
            ],
        )


def refresh_workflow_status(conversation_id: int | None = None) -> dict[str, Any]:
    """重算并返回工作流状态。全部读写在单个连接内完成。"""
    placeholders = ",".join("?" for _ in STAGE_DEFS)
    with connect() as conn:
        run_id = _ensure_run(conn, conversation_id)
        stage_counts = _stage_counts(conn, run_id)
        engaged = _engaged_stages(conn, run_id)
        _sync_nodes(conn, run_id, stage_counts, engaged)
        counts = _legacy_counts(conn, stage_counts)
        status = _finalize_run(
            conn,
            run_id,
            {
                "run_id": run_id,
                "conversation_id": conversation_id,
                "browser": {"mode": "user_controlled", "auth": {"status": "user_managed"}},
                "counts": counts,
                "stage_counts": stage_counts,
            },
        )

        run = row_to_dict(
            conn.execute("SELECT * FROM workflow_runs WHERE id = ?", (run_id,)).fetchone()
        )
        nodes = rows_to_dicts(
            conn.execute(
                f"""
                SELECT node_id AS id, title, status, detail, position, updated_at
                FROM workflow_nodes
                WHERE run_id = ? AND node_id IN ({placeholders})
                ORDER BY position ASC
                """,
                (run_id, *(stage_id for stage_id, _, _ in STAGE_DEFS)),
            ).fetchall()
        )
        events = rows_to_dicts(
            conn.execute(
                """
                SELECT id, node_id, event_type, message, payload_json, created_at
                FROM workflow_events
                WHERE run_id = ?
                ORDER BY id DESC
                LIMIT 20
                """,
                (run_id,),
            ).fetchall()
        )

    hints = {stage_id: hint for stage_id, _, hint in STAGE_DEFS}
    for node in nodes:
        node["hint"] = hints.get(node["id"], "")

    return {
        "run": run,
        "status": status,
        "counts": counts,
        "stage_counts": stage_counts,
        "nodes": nodes,
        "events": events,
    }

from __future__ import annotations

from pathlib import Path

from ..db import connect
from ..domain import AgentRunSnapshot


def save_run_snapshot(
    conversation_id: int,
    snapshot: AgentRunSnapshot,
    db_path: str | Path | None = None,
) -> None:
    payload = snapshot.model_dump_json()
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO agent_run_snapshots (conversation_id, snapshot_json)
            VALUES (?, ?)
            ON CONFLICT(conversation_id) DO UPDATE SET
                snapshot_json = excluded.snapshot_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (conversation_id, payload),
        )


def load_run_snapshot(
    conversation_id: int,
    db_path: str | Path | None = None,
) -> AgentRunSnapshot | None:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT snapshot_json FROM agent_run_snapshots WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()
    if row is None:
        return None
    raw = row["snapshot_json"]
    if not raw:
        return None
    return AgentRunSnapshot.model_validate_json(raw)


def clear_run_snapshot(
    conversation_id: int,
    db_path: str | Path | None = None,
) -> None:
    with connect(db_path) as conn:
        conn.execute(
            "DELETE FROM agent_run_snapshots WHERE conversation_id = ?",
            (conversation_id,),
        )

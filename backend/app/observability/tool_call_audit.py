from __future__ import annotations

from pathlib import Path

from ..db import connect


def record_tool_call_event(
    *,
    conversation_id: int | None,
    round_number: int,
    tool_call_id: str,
    tool_name: str,
    status: str,
    latency_ms: int,
    error_code: str = "",
    db_path: str | Path | None = None,
) -> None:
    """Persist only operational metadata; tool arguments and results are never stored."""
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO agent_tool_calls (
                conversation_id, round, tool_call_id, tool_name, status,
                latency_ms, error_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                conversation_id or 0,
                round_number,
                tool_call_id,
                tool_name,
                status,
                max(0, latency_ms),
                error_code,
            ),
        )
        conn.execute(
            "DELETE FROM agent_tool_calls WHERE created_at < datetime('now', '-30 days')"
        )

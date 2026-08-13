from __future__ import annotations

from pathlib import Path

from ..db import connect, row_to_dict, rows_to_dicts


def list_conversations(db_path: str | Path | None = None) -> list[dict]:
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT c.*,
                   COUNT(m.id) AS message_count,
                   MAX(m.created_at) AS last_message_at,
                   COALESCE((
                       SELECT status FROM conversation_tasks t
                       WHERE t.conversation_id = c.id
                       ORDER BY t.id DESC LIMIT 1
                   ), 'active') AS task_status
            FROM conversations c
            LEFT JOIN chat_messages m ON m.conversation_id = c.id
            GROUP BY c.id
            ORDER BY CASE WHEN c.status = 'active' THEN 0 ELSE 1 END,
                     COALESCE(MAX(m.created_at), c.updated_at) DESC,
                     c.id DESC
            """
        ).fetchall()
    return rows_to_dicts(rows)


def get_conversation(conversation_id: int, db_path: str | Path | None = None) -> dict | None:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
    return row_to_dict(row)


def create_conversation(title: str = "新对话", db_path: str | Path | None = None) -> dict:
    clean_title = title.strip()[:80] or "新对话"
    with connect(db_path) as conn:
        cursor = conn.execute(
            "INSERT INTO conversations (title) VALUES (?)", (clean_title,)
        )
        conversation_id = cursor.lastrowid
        conn.execute(
            "INSERT INTO conversation_tasks (conversation_id, title) VALUES (?, ?)",
            (conversation_id, "当前任务"),
        )
        row = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
    return row_to_dict(row)


def ensure_active_task(conversation_id: int, db_path: str | Path | None = None) -> int:
    with connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT id FROM conversation_tasks
            WHERE conversation_id = ? AND status = 'active'
            ORDER BY id DESC LIMIT 1
            """,
            (conversation_id,),
        ).fetchone()
        if row is not None:
            return row["id"]
        cursor = conn.execute(
            "INSERT INTO conversation_tasks (conversation_id, title) VALUES (?, ?)",
            (conversation_id, "当前任务"),
        )
        return cursor.lastrowid


def update_conversation(
    conversation_id: int,
    *,
    title: str | None = None,
    status: str | None = None,
    db_path: str | Path | None = None,
) -> dict | None:
    fields: list[str] = []
    values: list[object] = []
    if title is not None:
        fields.append("title = ?")
        values.append(title.strip()[:80] or "新对话")
    if status is not None:
        fields.append("status = ?")
        values.append(status)
    if not fields:
        return get_conversation(conversation_id, db_path)
    fields.append("updated_at = CURRENT_TIMESTAMP")
    with connect(db_path) as conn:
        conn.execute(
            f"UPDATE conversations SET {', '.join(fields)} WHERE id = ?",
            (*values, conversation_id),
        )
        row = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
    return row_to_dict(row)


def end_active_task(conversation_id: int, db_path: str | Path | None = None) -> bool:
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            UPDATE conversation_tasks
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE conversation_id = ? AND status = 'active'
            """,
            (conversation_id,),
        )
    return cursor.rowcount > 0


def reset_conversation_context(
    conversation_id: int, db_path: str | Path | None = None
) -> dict | None:
    with connect(db_path) as conn:
        latest = conn.execute(
            "SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()["id"]
        cursor = conn.execute(
            """
            UPDATE conversations
            SET context_cutoff_message_id = ?, summary = '', updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (latest, conversation_id),
        )
        if cursor.rowcount == 0:
            return None
        row = conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
    end_active_task(conversation_id, db_path)
    return row_to_dict(row)


def delete_conversation(conversation_id: int, db_path: str | Path | None = None) -> bool:
    with connect(db_path) as conn:
        cursor = conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    return cursor.rowcount > 0


def maybe_title_from_first_message(
    conversation_id: int, content: str, db_path: str | Path | None = None
) -> None:
    with connect(db_path) as conn:
        conversation = conn.execute(
            "SELECT title FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
        count = conn.execute(
            "SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id = ? AND role = 'user'",
            (conversation_id,),
        ).fetchone()["count"]
        if conversation and conversation["title"] in {"新对话", "历史对话"} and count <= 1:
            title = " ".join(content.strip().split())[:28] or "新对话"
            conn.execute(
                "UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (title, conversation_id),
            )

"""Durable knowledge proposals and review; IDs are persisted, never derived from text."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from ..db import connect, json_dump, row_to_dict


KNOWLEDGE_STATUSES = {"pending", "confirmed", "disputed", "retracted", "superseded"}
def _validated_id(item_id: int) -> int:
    if item_id <= 0:
        raise ValueError("知识标识不合法")
    return item_id


def _loads(value: str | None, fallback: Any) -> Any:
    try:
        return json.loads(value or "")
    except (TypeError, ValueError):
        return fallback


def _response(row: Any, evidence: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    item = row_to_dict(row) or {}
    if not item:
        return item
    item["id"] = int(item["id"])
    item["status"] = {
        "pending": "pending",
        "disputed": "disputed",
    }.get(item.get("status") or "pending", item.get("status") or "pending")
    if not isinstance(item.get("value"), dict):
        item["value"] = _loads(item.pop("value_json", None), {})
    if not isinstance(item.get("metadata"), dict):
        item["metadata"] = _loads(item.pop("metadata_json", None), {})
    item["evidence"] = evidence or []
    return item


def propose_knowledge(
    *,
    library_id: int = 1,
    category: str,
    statement: str,
    canonical_key: str = "",
    value: dict[str, Any] | None = None,
    sensitivity: str = "private",
    confidence: float = 0.0,
    source_id: int | None = None,
    excerpt: str = "",
    locator: str = "",
    source_kind: str = "agent_proposal",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    clean_statement = " ".join(statement.split())
    if library_id != 1:
        raise ValueError("资料库标识不合法")
    if not clean_statement:
        raise ValueError("知识内容不能为空")
    if sensitivity not in {"public", "private", "sensitive"}:
        raise ValueError("知识敏感级别不合法")
    clean_key = canonical_key.strip()[:200]
    with connect(db_path) as conn:
        conn.execute("INSERT OR IGNORE INTO library_metadata (id) VALUES (1)")
        if clean_key:
            keyed = conn.execute(
                """
                SELECT * FROM library_knowledge
                WHERE library_id = ? AND canonical_key = ?
                  AND status IN ('pending', 'confirmed', 'disputed', 'retracted')
                ORDER BY CASE status
                    WHEN 'confirmed' THEN 0
                    WHEN 'pending' THEN 1
                    WHEN 'disputed' THEN 2
                    WHEN 'retracted' THEN 3
                    ELSE 4
                END, id DESC
                LIMIT 1
                """,
                (library_id, clean_key),
            ).fetchone()
            if keyed is not None:
                return get_knowledge(int(keyed["id"]), db_path=db_path) or {}
        duplicate = conn.execute(
            """
            SELECT * FROM library_knowledge
            WHERE library_id = ? AND category = ? AND statement = ?
              AND status IN ('pending', 'confirmed', 'disputed', 'retracted')
            ORDER BY CASE status
                WHEN 'confirmed' THEN 0
                WHEN 'pending' THEN 1
                WHEN 'disputed' THEN 2
                WHEN 'retracted' THEN 3
                ELSE 4
            END, id DESC
            LIMIT 1
            """,
            (library_id, category.strip()[:50], clean_statement),
        ).fetchone()
        if duplicate is not None:
            return get_knowledge(int(duplicate["id"]), db_path=db_path) or {}
        cursor = conn.execute(
            """
            INSERT INTO library_knowledge (
                library_id, category, statement, canonical_key, value_json,
                status, sensitivity, confidence, source_kind
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
            """,
            (
                library_id,
                category.strip()[:50],
                clean_statement[:5000],
                canonical_key.strip()[:200],
                json_dump(value or {}),
                sensitivity,
                max(0.0, min(1.0, float(confidence))),
                source_kind[:50],
            ),
        )
        item_id = int(cursor.lastrowid)
        if source_id is not None or excerpt.strip():
            conn.execute(
                """
                INSERT INTO library_evidence (
                    knowledge_id, source_id, excerpt, locator
                ) VALUES (?, ?, ?, ?)
                """,
                (item_id, source_id, excerpt.strip()[:5000], locator.strip()[:500]),
            )
    return get_knowledge(item_id, db_path=db_path) or {}


def get_knowledge(item_id: int, db_path: str | Path | None = None) -> dict[str, Any] | None:
    internal_id = _validated_id(item_id)
    with connect(db_path) as conn:
        item_row = conn.execute(
            "SELECT * FROM library_knowledge WHERE id = ?", (internal_id,)
        ).fetchone()
        if item_row is None:
            return None
        evidence_rows = conn.execute(
            """
            SELECT source_id, excerpt, locator, created_at
            FROM library_evidence WHERE knowledge_id = ? ORDER BY id
            """,
            (internal_id,),
        ).fetchall()
    evidence = [
        {
            "source_id": row["source_id"],
            "source_title": "来源资料",
            "excerpt": row["excerpt"],
            "locator": row["locator"],
            "created_at": row["created_at"],
        }
        for row in evidence_rows
    ]
    return _response(item_row, evidence)


def list_knowledge(
    *,
    library_id: int = 1,
    status: str | None = None,
    category: str | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    if status is not None and status not in KNOWLEDGE_STATUSES:
        raise ValueError("知识状态不合法")
    clauses = ["library_id = ?"]
    values: list[Any] = [library_id]
    if status is not None:
        clauses.append("status = ?")
        values.append(status)
    if category:
        clauses.append("category = ?")
        values.append(category)
    with connect(db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM library_knowledge WHERE {' AND '.join(clauses)} "
            "ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC",
            values,
        ).fetchall()
        evidence_rows = conn.execute(
            "SELECT * FROM library_evidence ORDER BY id"
        ).fetchall()
    by_item: dict[int, list[dict[str, Any]]] = {}
    for evidence in evidence_rows:
        by_item.setdefault(int(evidence["knowledge_id"]), []).append(
            {
                "source_id": evidence["source_id"],
                "source_title": "来源资料",
                "excerpt": evidence["excerpt"],
                "locator": evidence["locator"],
                "created_at": evidence["created_at"],
            }
        )
    return [_response(row, by_item.get(int(row["id"]), [])) for row in rows]


def review_knowledge(
    item_id: int,
    *,
    action: Literal["confirm", "edit", "reject", "retract"],
    statement: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    internal_id = _validated_id(item_id)
    next_status = {
        "confirm": "confirmed",
        "edit": "confirmed",
        "reject": "disputed",
        "retract": "retracted",
    }[action]
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM library_knowledge WHERE id = ?", (internal_id,)
        ).fetchone()
        if row is None:
            raise ValueError("知识条目不存在")
        if row["status"] == "superseded":
            raise ValueError("已合并的知识不能再次审核")
        clean_statement = " ".join(statement.split())
        if action == "edit" and not clean_statement:
            raise ValueError("编辑后内容不能为空")
        conn.execute(
            """
            UPDATE library_knowledge
            SET status = ?, statement = COALESCE(NULLIF(?, ''), statement),
                reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (next_status, clean_statement[:5000], internal_id),
        )
        _touch_revision(conn)
    return get_knowledge(item_id, db_path=db_path) or {}


def merge_knowledge(
    source_item_id: int,
    target_item_id: int,
    *,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    source_id, target_id = _validated_id(source_item_id), _validated_id(target_item_id)
    if source_id == target_id:
        raise ValueError("不能合并同一条知识")
    with connect(db_path) as conn:
        source = conn.execute("SELECT library_id, status, superseded_by_id FROM library_knowledge WHERE id = ?", (source_id,)).fetchone()
        target = conn.execute("SELECT library_id, status, superseded_by_id FROM library_knowledge WHERE id = ?", (target_id,)).fetchone()
        if source is None or target is None or source["library_id"] != target["library_id"]:
            raise ValueError("知识条目不存在或不属于同一资料库")
        if target["status"] == "superseded":
            raise ValueError("不能合并到已被替代的知识")
        if source["status"] == "superseded":
            if source["superseded_by_id"] == target_id:
                return get_knowledge(target_item_id, db_path=db_path) or {}
            raise ValueError("知识已合并到其他条目")
        rows = conn.execute(
            "SELECT source_id, excerpt, locator FROM library_evidence WHERE knowledge_id = ?",
            (source_id,),
        ).fetchall()
        conn.executemany(
            """
            INSERT INTO library_evidence (knowledge_id, source_id, excerpt, locator)
            VALUES (?, ?, ?, ?)
            """,
            ((target_id, row["source_id"], row["excerpt"], row["locator"]) for row in rows),
        )
        conn.execute(
            """
            UPDATE library_knowledge
            SET status = 'superseded', superseded_by_id = ?, reviewed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP WHERE id = ?
            """,
            (target_id, source_id),
        )
        _touch_revision(conn)
    return get_knowledge(target_item_id, db_path=db_path) or {}


def _touch_revision(conn):
    conn.execute("UPDATE library_metadata SET knowledge_revision = knowledge_revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1")

"""Durable, reviewable candidate-memory records.

The profile Markdown document remains the user-readable baseline.  This module
stores new Agent-derived knowledge separately so it cannot silently become a
claim the Agent is allowed to use.  Confirmed records are read alongside the
document; proposed records stay in the review inbox.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from ..db import connect, json_dump, row_to_dict


MEMORY_STATUSES = {"proposed", "confirmed", "rejected", "retracted", "superseded"}
# Profile-document facts use deterministic low IDs.  A separate range avoids
# breaking existing story and strategy links while both representations coexist.
MEMORY_ID_OFFSET = 1_000_000


def is_memory_id(item_id: int) -> bool:
    return item_id >= MEMORY_ID_OFFSET


def _external_id(item_id: int) -> int:
    return MEMORY_ID_OFFSET + item_id


def _internal_id(item_id: int) -> int:
    if not is_memory_id(item_id):
        raise ValueError("不是记忆账本条目")
    return item_id - MEMORY_ID_OFFSET


def _loads(value: str | None, fallback: Any) -> Any:
    try:
        return json.loads(value or "")
    except (TypeError, ValueError):
        return fallback


def _response(row: Any, evidence: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    item = row_to_dict(row) or {}
    if not item:
        return item
    item["memory_id"] = int(item["id"])
    item["memory_item"] = True
    item["id"] = _external_id(int(item["id"]))
    item["status"] = {
        "proposed": "pending",
        "rejected": "disputed",
    }.get(item.get("status") or "proposed", item.get("status") or "proposed")
    item["value"] = _loads(item.pop("value_json", "{}"), {})
    item["metadata"] = _loads(item.pop("metadata_json", "{}"), {})
    item["evidence"] = evidence or []
    return item


def propose_memory(
    *,
    profile_id: int,
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
    if not clean_statement:
        raise ValueError("记忆内容不能为空")
    if sensitivity not in {"public", "private", "sensitive"}:
        raise ValueError("记忆敏感级别不合法")
    with connect(db_path) as conn:
        duplicate = conn.execute(
            """
            SELECT * FROM candidate_memory_items
            WHERE profile_id = ? AND category = ? AND statement = ?
              AND status IN ('proposed', 'confirmed')
            ORDER BY id DESC LIMIT 1
            """,
            (profile_id, category.strip()[:50], clean_statement),
        ).fetchone()
        if duplicate is not None:
            return get_memory_item(_external_id(int(duplicate["id"])), db_path=db_path) or {}
        cursor = conn.execute(
            """
            INSERT INTO candidate_memory_items (
                profile_id, category, statement, canonical_key, value_json,
                status, sensitivity, confidence, source_kind
            ) VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?)
            """,
            (
                profile_id,
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
                INSERT INTO candidate_memory_evidence (
                    memory_item_id, source_id, excerpt, locator
                ) VALUES (?, ?, ?, ?)
                """,
                (item_id, source_id, excerpt.strip()[:5000], locator.strip()[:500]),
            )
    return get_memory_item(_external_id(item_id), db_path=db_path) or {}


def get_memory_item(item_id: int, db_path: str | Path | None = None) -> dict[str, Any] | None:
    internal_id = _internal_id(item_id)
    with connect(db_path) as conn:
        item_row = conn.execute(
            "SELECT * FROM candidate_memory_items WHERE id = ?", (internal_id,)
        ).fetchone()
        if item_row is None:
            return None
        evidence_rows = conn.execute(
            """
            SELECT source_id, excerpt, locator, created_at
            FROM candidate_memory_evidence WHERE memory_item_id = ? ORDER BY id
            """,
            (internal_id,),
        ).fetchall()
    evidence = [
        {
            "source_id": row["source_id"],
            "source_title": "候选人资料",
            "excerpt": row["excerpt"],
            "locator": row["locator"],
            "created_at": row["created_at"],
        }
        for row in evidence_rows
    ]
    return _response(item_row, evidence)


def list_memory_items(
    *,
    profile_id: int,
    status: str | None = None,
    category: str | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    if status is not None and status not in MEMORY_STATUSES:
        raise ValueError("记忆状态不合法")
    clauses = ["profile_id = ?"]
    values: list[Any] = [profile_id]
    if status is not None:
        clauses.append("status = ?")
        values.append(status)
    if category:
        clauses.append("category = ?")
        values.append(category)
    with connect(db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM candidate_memory_items WHERE {' AND '.join(clauses)} "
            "ORDER BY CASE status WHEN 'proposed' THEN 0 ELSE 1 END, id DESC",
            values,
        ).fetchall()
        evidence_rows = conn.execute(
            "SELECT * FROM candidate_memory_evidence ORDER BY id"
        ).fetchall()
    by_item: dict[int, list[dict[str, Any]]] = {}
    for evidence in evidence_rows:
        by_item.setdefault(int(evidence["memory_item_id"]), []).append(
            {
                "source_id": evidence["source_id"],
                "source_title": "候选人资料",
                "excerpt": evidence["excerpt"],
                "locator": evidence["locator"],
                "created_at": evidence["created_at"],
            }
        )
    return [_response(row, by_item.get(int(row["id"]), [])) for row in rows]


def review_memory(
    item_id: int,
    *,
    action: Literal["confirm", "edit", "reject", "retract"],
    statement: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    internal_id = _internal_id(item_id)
    next_status = {
        "confirm": "confirmed",
        "edit": "confirmed",
        "reject": "rejected",
        "retract": "retracted",
    }[action]
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM candidate_memory_items WHERE id = ?", (internal_id,)
        ).fetchone()
        if row is None:
            raise ValueError("记忆条目不存在")
        clean_statement = " ".join(statement.split())
        if action == "edit" and not clean_statement:
            raise ValueError("编辑后内容不能为空")
        conn.execute(
            """
            UPDATE candidate_memory_items
            SET status = ?, statement = COALESCE(NULLIF(?, ''), statement),
                reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (next_status, clean_statement[:5000], internal_id),
        )
    return get_memory_item(item_id, db_path=db_path) or {}


def merge_memory(
    source_item_id: int,
    target_item_id: int,
    *,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    source_id, target_id = _internal_id(source_item_id), _internal_id(target_item_id)
    if source_id == target_id:
        raise ValueError("不能合并同一条记忆")
    with connect(db_path) as conn:
        source = conn.execute("SELECT profile_id FROM candidate_memory_items WHERE id = ?", (source_id,)).fetchone()
        target = conn.execute("SELECT profile_id FROM candidate_memory_items WHERE id = ?", (target_id,)).fetchone()
        if source is None or target is None or source["profile_id"] != target["profile_id"]:
            raise ValueError("记忆条目不存在或不属于同一画像")
        rows = conn.execute(
            "SELECT source_id, excerpt, locator FROM candidate_memory_evidence WHERE memory_item_id = ?",
            (source_id,),
        ).fetchall()
        conn.executemany(
            """
            INSERT INTO candidate_memory_evidence (memory_item_id, source_id, excerpt, locator)
            VALUES (?, ?, ?, ?)
            """,
            ((target_id, row["source_id"], row["excerpt"], row["locator"]) for row in rows),
        )
        conn.execute(
            """
            UPDATE candidate_memory_items
            SET status = 'superseded', superseded_by_id = ?, reviewed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP WHERE id = ?
            """,
            (target_id, source_id),
        )
    return get_memory_item(target_item_id, db_path=db_path) or {}

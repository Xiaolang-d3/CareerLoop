"""Account-local topic collections reference files without copying or enabling them."""
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..db import connect


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    source_ids: list[int] = Field(default_factory=list, max_length=500)


class CollectionSourcesIn(BaseModel):
    source_ids: list[int] = Field(min_length=1, max_length=500)
    action: Literal["add", "remove"] = "add"


def list_collections(db_path: str | Path | None = None) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        collections = [dict(row) for row in conn.execute("SELECT * FROM library_collections ORDER BY id")]
        members = conn.execute("""
            SELECT m.collection_id, m.source_id,
                json_extract(s.metadata_json, '$.organization.trashed_at') AS trashed_at
            FROM library_collection_sources m JOIN library_sources s ON s.id = m.source_id
            ORDER BY m.source_id
        """).fetchall()
    by_id = {collection["id"]: collection for collection in collections}
    for collection in collections:
        collection.update(source_ids=[], file_count=0)
    for row in members:
        collection = by_id[row["collection_id"]]
        collection["source_ids"].append(row["source_id"])
        collection["file_count"] += int(not row["trashed_at"])
    return collections


def save_collection(
    name: str, db_path: str | Path | None = None, *, collection_id: int | None = None, source_ids: list[int] | None = None
) -> dict[str, Any]:
    clean = " ".join(name.split())
    if not clean or len(clean) > 180:
        raise ValueError("主题集合名称须为 1–180 字")
    with connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        rows = conn.execute("SELECT id, name FROM library_collections").fetchall()
        if collection_id is not None and not any(row["id"] == collection_id for row in rows):
            raise ValueError("主题集合不存在")
        if any(row["id"] != collection_id and row["name"].casefold() == clean.casefold() for row in rows):
            raise ValueError("同名主题集合已存在")
        if collection_id is None:
            collection_id = int(conn.execute("INSERT INTO library_collections(name) VALUES (?)", (clean,)).lastrowid)
            if source_ids:
                ids = _validate_sources(conn, source_ids, adding=True)
                conn.executemany("INSERT INTO library_collection_sources(collection_id, source_id) VALUES (?, ?)",
                                 [(collection_id, item) for item in ids])
        else:
            conn.execute("UPDATE library_collections SET name = ? WHERE id = ?", (clean, collection_id))
        result = dict(conn.execute("SELECT * FROM library_collections WHERE id = ?", (collection_id,)).fetchone())
    return result


def _validate_sources(conn, source_ids: list[int], *, adding: bool) -> list[int]:
    ids = list(dict.fromkeys(source_ids))
    if not ids or len(ids) > 500 or any(type(item) is not int or item <= 0 for item in ids):
        raise ValueError("请选择有效文件")
    placeholders = ",".join("?" for _ in ids)
    count = conn.execute(f"SELECT COUNT(*) FROM library_sources WHERE id IN ({placeholders})", ids).fetchone()[0]
    if count != len(ids):
        raise ValueError("资料来源不存在")
    if adding and conn.execute(
        f"SELECT 1 FROM library_sources WHERE id IN ({placeholders}) AND json_extract(metadata_json, '$.organization.trashed_at') IS NOT NULL", ids
    ).fetchone():
        raise ValueError("请先恢复文件，再加入主题集合")
    return ids


def update_collection_sources(
    collection_id: int, source_ids: list[int], *, action: str = "add", db_path: str | Path | None = None
) -> None:
    if action not in {"add", "remove"}:
        raise ValueError("集合操作不合法")
    with connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        if not conn.execute("SELECT 1 FROM library_collections WHERE id = ?", (collection_id,)).fetchone():
            raise ValueError("主题集合不存在")
        ids = _validate_sources(conn, source_ids, adding=action == "add")
        if action == "add":
            conn.executemany("INSERT OR IGNORE INTO library_collection_sources(collection_id, source_id) VALUES (?, ?)",
                             [(collection_id, item) for item in ids])
        else:
            conn.executemany("DELETE FROM library_collection_sources WHERE collection_id = ? AND source_id = ?",
                             [(collection_id, item) for item in ids])


def delete_collection(collection_id: int, db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        if not conn.execute("DELETE FROM library_collections WHERE id = ?", (collection_id,)).rowcount:
            raise ValueError("主题集合不存在")

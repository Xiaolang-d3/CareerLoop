"""Account-local folders and reversible file organization."""
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from ..db import connect, json_dump
from .sources import _index_source, get_source


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)


class OrganizationIn(BaseModel):
    folder_id: int | None = Field(default=None, ge=1)
    favorite: bool | None = None
    trashed: bool | None = None
    opened: bool | None = None


def list_folders(db_path: str | Path | None = None) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM library_folders ORDER BY id")]


def create_folder(name: str, db_path: str | Path | None = None) -> dict[str, Any]:
    name = " ".join(name.split())
    if not name:
        raise ValueError("文件夹名称不能为空")
    with connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        if any(row["name"].casefold() == name.casefold() for row in conn.execute("SELECT name FROM library_folders")):
            raise ValueError("同名文件夹已存在")
        cursor = conn.execute("INSERT INTO library_folders(name) VALUES (?)", (name[:180],))
        return dict(conn.execute("SELECT * FROM library_folders WHERE id = ?", (cursor.lastrowid,)).fetchone())


def organize_source(source_id: int, changes: dict[str, Any], db_path: str | Path | None = None) -> dict[str, Any]:
    # Read and merge metadata while holding a write lock; rapid favorite/open/move
    # requests must not replace one another or parser metadata.
    with connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT metadata_json FROM library_sources WHERE id = ?", (source_id,)).fetchone()
        if row is None:
            raise ValueError("资料来源不存在")
        metadata = json.loads(row["metadata_json"] or "{}")
        organization = dict(metadata.get("organization") or {})
        if "folder_id" in changes:
            folder_id = changes["folder_id"]
            if folder_id is not None and not conn.execute("SELECT 1 FROM library_folders WHERE id = ?", (folder_id,)).fetchone():
                raise ValueError("目标文件夹不存在")
            organization["folder_id"] = folder_id
        if changes.get("favorite") is not None:
            organization["favorite"] = changes["favorite"]
        now = datetime.now(timezone.utc).isoformat()
        if changes.get("trashed") is not None:
            organization["trashed_at"] = now if changes["trashed"] else None
        if changes.get("opened"):
            organization["last_opened_at"] = now
        metadata["organization"] = organization
        conn.execute("UPDATE library_sources SET metadata_json = ? WHERE id = ?", (json_dump(metadata), source_id))
    source = get_source(source_id, db_path)
    if changes.get("trashed") is not None:
        _index_source(source, db_path)
    return source

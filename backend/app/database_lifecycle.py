from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import db as db_module


REBUILD_CONFIRMATION = "确认重建 BossCopilot 2.0 数据库"


def database_status(db_path: str | Path | None = None) -> dict[str, Any]:
    path = Path(db_path) if db_path is not None else db_module.DB_PATH
    if not path.exists() or path.stat().st_size == 0:
        return {
            "status": "uninitialized",
            "schema_version": None,
            "required_schema_version": db_module.DB_SCHEMA_VERSION,
            "database_path": str(path),
        }
    try:
        conn = sqlite3.connect(path)
        tables = {
            str(row[0])
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        versions = (
            [int(row[0]) for row in conn.execute("SELECT version FROM schema_migrations")]
            if "schema_migrations" in tables
            else []
        )
    except sqlite3.DatabaseError as exc:
        return {
            "status": "requires_rebuild",
            "schema_version": None,
            "required_schema_version": db_module.DB_SCHEMA_VERSION,
            "database_path": str(path),
            "reason": f"数据库无法读取：{exc}",
        }
    finally:
        if "conn" in locals():
            conn.close()
    current = max(versions, default=0)
    return {
        "status": "ready" if current >= db_module.DB_SCHEMA_VERSION else "requires_rebuild",
        "schema_version": current or None,
        "required_schema_version": db_module.DB_SCHEMA_VERSION,
        "database_path": str(path),
        "reason": "" if current >= db_module.DB_SCHEMA_VERSION else "检测到 BossCopilot 2.0 之前的本地数据库",
    }


def initialize_or_report(db_path: str | Path | None = None) -> dict[str, Any]:
    status = database_status(db_path)
    if status["status"] == "uninitialized":
        db_module.init_db(db_path)
        return database_status(db_path)
    if status["status"] == "requires_rebuild" and status["schema_version"] is not None:
        db_module.init_db(db_path)
        return database_status(db_path)
    return status


def rebuild_database_v2(
    confirmation: str,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if confirmation != REBUILD_CONFIRMATION:
        raise ValueError("需要明确确认后才能备份并重建数据库")
    path = Path(db_path) if db_path is not None else db_module.DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup_path: Path | None = None
    if path.exists() and path.stat().st_size:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
        backup_path = path.with_name(f"{path.stem}.pre-v2-{stamp}{path.suffix}")
        source = sqlite3.connect(path)
        backup = sqlite3.connect(backup_path)
        try:
            source.backup(backup)
        finally:
            backup.close()
            source.close()
        backup_path.chmod(0o600)
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        candidate.unlink(missing_ok=True)
    try:
        db_module.init_db(path)
    except Exception:
        if backup_path is not None and backup_path.exists():
            shutil.copy2(backup_path, path)
        raise
    return {
        **database_status(path),
        "backup_path": str(backup_path) if backup_path is not None else None,
    }

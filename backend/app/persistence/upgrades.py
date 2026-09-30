"""Fresh initialization and recoverable, serialized workspace upgrades."""
from __future__ import annotations

import shutil
import sqlite3
import threading
from pathlib import Path

from ..db import DB_SCHEMA_VERSION, connect
from ..workspace import resolve_db_path, resolve_document_dir
from .schema import CURRENT_SCHEMA


_upgrade_lock = threading.RLock()


def _backup(path: Path) -> None:
    directory = path.parent / ".upgrade-backups" / "before-library-v23"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    target = directory / path.name
    if not target.exists():
        temporary = target.with_suffix(".tmp")
        with sqlite3.connect(path) as source, sqlite3.connect(temporary) as backup:
            source.backup(backup)
        temporary.chmod(0o600)
        temporary.replace(target)
    # Upgrades never rewrite source files or attachments. Preserve the only
    # historical file we interpret, alongside the coherent SQLite snapshot.
    document = resolve_document_dir(path) / "career-profile.md"
    saved_document = directory / document.name
    if document.exists() and not saved_document.exists():
        shutil.copyfile(document, saved_document)
        saved_document.chmod(0o600)


def initialize_workspace(db_path: str | Path | None = None) -> None:
    path = resolve_db_path(db_path)
    with _upgrade_lock:
        with connect(path) as conn:
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            version = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").fetchone()[0] if "schema_migrations" in tables else 0
        if version == DB_SCHEMA_VERSION:
            return
        if version > DB_SCHEMA_VERSION:
            raise ValueError("数据库来自更新版本，请升级应用后打开")
        if tables:
            if not 1 <= version <= 22:
                raise ValueError("未知数据库格式，未修改原文件")
            _backup(path)
            if version < 22:
                from ..compatibility.schema_v22 import init_db as upgrade_to_v22
                upgrade_to_v22(path)
        with connect(path) as conn:
            conn.executescript(CURRENT_SCHEMA)
            conn.execute("INSERT OR IGNORE INTO agent_settings (id) VALUES (1)")
            if conn.execute("SELECT 1 FROM conversations LIMIT 1").fetchone() is None:
                cursor = conn.execute("INSERT INTO conversations (title) VALUES ('历史对话')")
                conn.execute("INSERT INTO conversation_tasks (conversation_id, title) VALUES (?, '历史任务')", (cursor.lastrowid,))
        if tables:
            from ..compatibility.library_v23 import migrate_library
            migrate_library(path)
        # Indexing is a recoverable phase. The completion version is written
        # only after it succeeds; data imports use persisted IDs and markers.
        from ..library.sources import _index_source, enabled_source_details
        for source in enabled_source_details(path):
            _index_source(source, path)
        with connect(path) as conn:
            conn.execute("INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, 'independent_library')", (DB_SCHEMA_VERSION,))

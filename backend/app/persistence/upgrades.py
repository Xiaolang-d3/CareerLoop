"""Fresh initialization and recoverable, serialized workspace upgrades."""
from __future__ import annotations

import json
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
            if not 1 <= version <= 26:
                raise ValueError("未知数据库格式，未修改原文件")
            if version < 24:
                _backup(path)
            if version < 22:
                from ..compatibility.schema_v22 import init_db as upgrade_to_v22
                upgrade_to_v22(path)
        with connect(path) as conn:
            conn.executescript(CURRENT_SCHEMA)
            columns = {row[1] for row in conn.execute("PRAGMA table_info(agent_settings)")}
            if "profile_memory_enabled" in columns:
                conn.execute("ALTER TABLE agent_settings RENAME COLUMN profile_memory_enabled TO library_memory_enabled")
            for name, definition in {
                "connection_id": "TEXT NOT NULL DEFAULT ''",
                "config_revision": "INTEGER NOT NULL DEFAULT 0",
                "last_save_request_id": "TEXT NOT NULL DEFAULT ''",
                "model_secret_ref": "TEXT NOT NULL DEFAULT ''",
                "model_config_initialized": "INTEGER NOT NULL DEFAULT 0",
                "default_model_profile_id": "TEXT NOT NULL DEFAULT ''",
            }.items():
                if name not in columns:
                    conn.execute(f"ALTER TABLE agent_settings ADD COLUMN {name} {definition}")
            conversation_columns = {row[1] for row in conn.execute("PRAGMA table_info(conversations)")}
            if "model_profile_id" not in conversation_columns:
                conn.execute("ALTER TABLE conversations ADD COLUMN model_profile_id TEXT")
            run_columns = {row[1] for row in conn.execute("PRAGMA table_info(agent_execution_runs)")}
            if "model_selection_json" not in run_columns:
                conn.execute("ALTER TABLE agent_execution_runs ADD COLUMN model_selection_json TEXT NOT NULL DEFAULT '{}'")
            event_columns = {row[1] for row in conn.execute("PRAGMA table_info(model_service_events)")}
            for name, definition in {
                "run_id": "TEXT NOT NULL DEFAULT ''", "call_id": "TEXT NOT NULL DEFAULT ''",
                "profile_id": "TEXT NOT NULL DEFAULT ''", "connection_id": "TEXT NOT NULL DEFAULT ''",
                "connection_revision": "INTEGER NOT NULL DEFAULT 0", "profile_revision": "INTEGER NOT NULL DEFAULT 0",
                "stage": "TEXT NOT NULL DEFAULT ''", "input_tokens": "INTEGER NOT NULL DEFAULT 0",
                "output_tokens": "INTEGER NOT NULL DEFAULT 0", "selection_reason": "TEXT NOT NULL DEFAULT ''",
            }.items():
                if name not in event_columns:
                    conn.execute(f"ALTER TABLE model_service_events ADD COLUMN {name} {definition}")
            conn.execute("UPDATE attachments SET kind = CASE kind WHEN 'resume' THEN 'document' WHEN 'job_screenshot' THEN 'image' ELSE kind END")
            for row in conn.execute("SELECT id, payload_json FROM chat_messages WHERE payload_json LIKE '%attachments%'").fetchall():
                payload = json.loads(row["payload_json"] or "{}")
                if not isinstance(payload, dict):
                    continue
                changed = False
                for attachment in payload.get("attachments") or []:
                    if isinstance(attachment, dict) and attachment.get("kind") in {"resume", "job_screenshot"}:
                        attachment["kind"] = {"resume": "document", "job_screenshot": "image"}[attachment["kind"]]
                        changed = True
                if changed:
                    conn.execute("UPDATE chat_messages SET payload_json = ? WHERE id = ?", (json.dumps(payload, ensure_ascii=False), row["id"]))
            conn.execute("INSERT OR IGNORE INTO agent_settings (id) VALUES (1)")
            if conn.execute("SELECT 1 FROM conversations LIMIT 1").fetchone() is None:
                cursor = conn.execute("INSERT INTO conversations (title) VALUES ('历史对话')")
                conn.execute("INSERT INTO conversation_tasks (conversation_id, title) VALUES (?, '历史任务')", (cursor.lastrowid,))
        if tables and version < 23:
            from ..compatibility.library_v23 import migrate_library
            migrate_library(path)
        # Indexing is a recoverable phase. The completion version is written
        # only after it succeeds; data imports use persisted IDs and markers.
        from ..library.sources import _index_source, enabled_source_details
        for source in enabled_source_details(path):
            _index_source(source, path)
        with connect(path) as conn:
            conn.execute("INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, 'independent_library')", (DB_SCHEMA_VERSION,))

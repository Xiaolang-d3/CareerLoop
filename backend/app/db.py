from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Iterable


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
DB_PATH = DATA_DIR / "bosscopilot.db"


@contextmanager
def connect(db_path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    path = Path(db_path) if db_path is not None else DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass
    conn = sqlite3.connect(path, timeout=10)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 10000")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
        try:
            path.chmod(0o600)
        except OSError:
            pass


def init_db(db_path: str | Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '新对话',
                status TEXT NOT NULL DEFAULT 'active',
                summary TEXT NOT NULL DEFAULT '',
                context_cutoff_message_id INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS conversation_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                title TEXT NOT NULL DEFAULT '当前任务',
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                resume_text TEXT NOT NULL DEFAULT '',
                resume_filename TEXT NOT NULL DEFAULT '',
                resume_redacted_text TEXT NOT NULL DEFAULT '',
                privacy_mode TEXT NOT NULL DEFAULT 'redacted',
                skills_json TEXT NOT NULL DEFAULT '[]',
                projects_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id INTEGER NOT NULL,
                target_roles_json TEXT NOT NULL DEFAULT '[]',
                target_cities_json TEXT NOT NULL DEFAULT '[]',
                salary_min INTEGER,
                salary_max INTEGER,
                preferred_industries_json TEXT NOT NULL DEFAULT '[]',
                blocked_keywords_json TEXT NOT NULL DEFAULT '[]',
                blocked_companies_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS workflow_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'in_progress',
                current_node TEXT NOT NULL DEFAULT '',
                state_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS workflow_nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                node_id TEXT NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                detail TEXT NOT NULL DEFAULT '',
                position INTEGER NOT NULL DEFAULT 0,
                started_at TEXT,
                completed_at TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(run_id, node_id),
                FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS workflow_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                node_id TEXT NOT NULL DEFAULT '',
                event_type TEXT NOT NULL,
                message TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                task_id INTEGER,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                FOREIGN KEY (task_id) REFERENCES conversation_tasks(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                profile_id INTEGER,
                kind TEXT NOT NULL,
                object_key TEXT NOT NULL UNIQUE,
                original_filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                parse_status TEXT NOT NULL DEFAULT 'pending',
                parsed_text TEXT NOT NULL DEFAULT '',
                redacted_text TEXT NOT NULL DEFAULT '',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                vision_status TEXT NOT NULL DEFAULT 'not_requested',
                vision_consent_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS knowledge_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS agent_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                display_name TEXT NOT NULL DEFAULT 'BossCopilot',
                persona_role TEXT NOT NULL DEFAULT '理性、坦诚、尊重用户决定的本地求职顾问',
                response_style TEXT NOT NULL DEFAULT 'concise',
                custom_instructions TEXT NOT NULL DEFAULT '',
                profile_memory_enabled INTEGER NOT NULL DEFAULT 1,
                conversation_memory_enabled INTEGER NOT NULL DEFAULT 1,
                knowledge_memory_enabled INTEGER NOT NULL DEFAULT 1,
                summary_enabled INTEGER NOT NULL DEFAULT 1,
                context_message_limit INTEGER NOT NULL DEFAULT 12,
                model_name TEXT NOT NULL DEFAULT '',
                model_base_url TEXT NOT NULL DEFAULT '',
                model_api_key TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS company_research_cache (
                cache_key TEXT PRIMARY KEY,
                company_name TEXT NOT NULL,
                sources_json TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )

        # SQLite's CREATE TABLE IF NOT EXISTS does not add columns to an existing
        # local database. Keep upgrades additive so current user data is preserved.
        def ensure_column(table: str, column: str, definition: str) -> None:
            columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
            if column not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

        ensure_column("chat_messages", "conversation_id", "INTEGER REFERENCES conversations(id) ON DELETE CASCADE")
        ensure_column("chat_messages", "task_id", "INTEGER REFERENCES conversation_tasks(id) ON DELETE SET NULL")
        ensure_column("profiles", "resume_filename", "TEXT NOT NULL DEFAULT ''")
        ensure_column("profiles", "resume_redacted_text", "TEXT NOT NULL DEFAULT ''")
        ensure_column("profiles", "privacy_mode", "TEXT NOT NULL DEFAULT 'redacted'")
        ensure_column("conversations", "context_cutoff_message_id", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("attachments", "vision_status", "TEXT NOT NULL DEFAULT 'not_requested'")
        ensure_column("attachments", "vision_consent_at", "TEXT")
        ensure_column("agent_settings", "model_name", "TEXT NOT NULL DEFAULT ''")
        ensure_column("agent_settings", "model_base_url", "TEXT NOT NULL DEFAULT ''")
        ensure_column("agent_settings", "model_api_key", "TEXT NOT NULL DEFAULT ''")

        conn.execute("INSERT OR IGNORE INTO agent_settings (id) VALUES (1)")

        conversation = conn.execute(
            "SELECT id FROM conversations ORDER BY id ASC LIMIT 1"
        ).fetchone()
        if conversation is None:
            cursor = conn.execute(
                "INSERT INTO conversations (title) VALUES (?)", ("历史对话",)
            )
            conversation_id = cursor.lastrowid
        else:
            conversation_id = conversation["id"]

        task = conn.execute(
            "SELECT id FROM conversation_tasks WHERE conversation_id = ? ORDER BY id ASC LIMIT 1",
            (conversation_id,),
        ).fetchone()
        if task is None:
            cursor = conn.execute(
                "INSERT INTO conversation_tasks (conversation_id, title) VALUES (?, ?)",
                (conversation_id, "历史任务"),
            )
            task_id = cursor.lastrowid
        else:
            task_id = task["id"]

        conn.execute(
            "UPDATE chat_messages SET conversation_id = ?, task_id = COALESCE(task_id, ?) WHERE conversation_id IS NULL",
            (conversation_id, task_id),
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_conversation ON chat_messages(conversation_id, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON conversation_tasks(conversation_id, status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_chunks(source_type, source_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_attachments_conversation ON attachments(conversation_id, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_company_research_cache_updated ON company_research_cache(updated_at DESC)")


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    result = dict(row)
    for key, value in list(result.items()):
        if key.endswith("_json") and isinstance(value, str):
            result[key.removesuffix("_json")] = json.loads(value or "[]")
            del result[key]
        elif key == "raw_json" and isinstance(value, str):
            result["raw"] = json.loads(value or "{}")
            del result[key]
    return result


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row_to_dict(row) for row in rows if row is not None]


def json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)

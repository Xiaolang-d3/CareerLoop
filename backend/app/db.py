from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, Iterable


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
DB_PATH = DATA_DIR / "careerloop.db"
LEGACY_DB_PATH = DATA_DIR / "bosscopilot.db"
DB_SCHEMA_VERSION = 17


def adopt_legacy_database() -> None:
    """Rename the pre-rebrand bosscopilot.db (and WAL/SHM sidecars) to careerloop.db."""
    if DB_PATH.exists() or not LEGACY_DB_PATH.exists():
        return
    LEGACY_DB_PATH.rename(DB_PATH)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{LEGACY_DB_PATH}{suffix}")
        if sidecar.exists():
            sidecar.rename(Path(f"{DB_PATH}{suffix}"))


@contextmanager
def connect(db_path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    if db_path is not None:
        path = Path(db_path)
    else:
        from .workspace import resolve_db_path

        path = resolve_db_path()
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
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER,
                job_title TEXT NOT NULL DEFAULT '',
                company_name TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                salary_text TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'saved',
                priority TEXT NOT NULL DEFAULT 'medium',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS resume_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER,
                profile_id INTEGER NOT NULL,
                evaluation_id INTEGER,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                template_id TEXT NOT NULL DEFAULT 'classic',
                style_id TEXT NOT NULL DEFAULT 'navy',
                layout_json TEXT NOT NULL DEFAULT '{}',
                base_content TEXT NOT NULL,
                rendered_content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
                FOREIGN KEY (evaluation_id) REFERENCES job_evaluations(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS resume_changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version_id INTEGER NOT NULL,
                change_type TEXT NOT NULL,
                section_key TEXT NOT NULL,
                before_text TEXT NOT NULL DEFAULT '',
                after_text TEXT NOT NULL DEFAULT '',
                rationale TEXT NOT NULL DEFAULT '',
                evidence_json TEXT NOT NULL DEFAULT '[]',
                decision TEXT NOT NULL DEFAULT 'pending',
                user_edited INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (version_id) REFERENCES resume_versions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS interview_kits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                profile_id INTEGER NOT NULL,
                evaluation_id INTEGER,
                interview_type TEXT NOT NULL DEFAULT 'general',
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                content_json TEXT NOT NULL DEFAULT '{}',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
                FOREIGN KEY (evaluation_id) REFERENCES job_evaluations(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS interview_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kit_id INTEGER NOT NULL,
                category TEXT NOT NULL DEFAULT 'preparation',
                title TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (kit_id) REFERENCES interview_kits(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS interview_rounds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                kit_id INTEGER,
                round_type TEXT NOT NULL DEFAULT 'general',
                scheduled_at TEXT,
                interviewer TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'scheduled',
                outcome TEXT NOT NULL DEFAULT 'pending',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
                FOREIGN KEY (kit_id) REFERENCES interview_kits(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS job_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                title TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
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
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
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
                display_name TEXT NOT NULL DEFAULT 'CareerLoop',
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

            CREATE TABLE IF NOT EXISTS model_service_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                request_kind TEXT NOT NULL,
                status TEXT NOT NULL,
                error_code TEXT NOT NULL DEFAULT '',
                error_message TEXT NOT NULL DEFAULT '',
                latency_ms INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                model_name TEXT NOT NULL DEFAULT '',
                base_url TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_model_service_events_created_at
                ON model_service_events(created_at DESC);

            CREATE TABLE IF NOT EXISTS company_research_cache (
                cache_key TEXT PRIMARY KEY,
                company_name TEXT NOT NULL,
                sources_json TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )

        _apply_migrations(conn)
        # Compatibility mirrors are required by several legacy foreign keys.
        # Keep this idempotent guard so an interrupted/manual repair cannot
        # leave the document-backed profile without its SQLite counterpart.
        conn.executescript(_PROFILES_COMPATIBILITY_SCHEMA)

        # Fresh 2.0 databases still use guarded column creation for deterministic
        # test setup. Legacy user databases are stopped before init_db and must be
        # backed up and explicitly rebuilt by database_lifecycle.
        def ensure_column(table: str, column: str, definition: str) -> None:
            columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
            if column not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

        ensure_column("chat_messages", "conversation_id", "INTEGER REFERENCES conversations(id) ON DELETE CASCADE")
        ensure_column("chat_messages", "task_id", "INTEGER REFERENCES conversation_tasks(id) ON DELETE SET NULL")
        ensure_column("conversations", "context_cutoff_message_id", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("attachments", "vision_status", "TEXT NOT NULL DEFAULT 'not_requested'")
        ensure_column("attachments", "vision_consent_at", "TEXT")
        ensure_column("agent_settings", "model_name", "TEXT NOT NULL DEFAULT ''")
        ensure_column("agent_settings", "model_base_url", "TEXT NOT NULL DEFAULT ''")
        ensure_column("agent_settings", "model_api_key", "TEXT NOT NULL DEFAULT ''")
        ensure_column("jobs", "career_strategy_id", "INTEGER REFERENCES career_strategies(id) ON DELETE SET NULL")
        ensure_column("jobs", "discovered_job_id", "INTEGER REFERENCES discovered_jobs(id) ON DELETE SET NULL")
        ensure_column("resume_versions", "evaluation_id", "INTEGER REFERENCES job_evaluations(id) ON DELETE SET NULL")
        ensure_column("resume_versions", "template_id", "TEXT NOT NULL DEFAULT 'classic'")
        ensure_column("resume_versions", "style_id", "TEXT NOT NULL DEFAULT 'navy'")
        ensure_column("resume_versions", "layout_json", "TEXT NOT NULL DEFAULT '{}'")
        ensure_column("interview_kits", "evaluation_id", "INTEGER REFERENCES job_evaluations(id) ON DELETE SET NULL")
        ensure_column("career_strategies", "title_expansions_json", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column("career_strategies", "evaluation_weights_json", "TEXT NOT NULL DEFAULT '{}'")
        ensure_column("companies", "legal_name", "TEXT NOT NULL DEFAULT ''")
        ensure_column("companies", "unified_social_credit_code", "TEXT NOT NULL DEFAULT ''")
        ensure_column("companies", "identity_status", "TEXT NOT NULL DEFAULT 'unknown'")
        ensure_column("companies", "identity_evidence_json", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column("opportunity_sources", "access_mode", "TEXT NOT NULL DEFAULT 'public_page'")
        ensure_column("opportunity_sources", "platform", "TEXT NOT NULL DEFAULT ''")
        ensure_column("opportunity_sources", "detection_confidence", "REAL NOT NULL DEFAULT 0")
        ensure_column("opportunity_sources", "evidence_json", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column("discovered_jobs", "processing_status", "TEXT NOT NULL DEFAULT 'queued'")
        ensure_column("discovered_jobs", "duplicate_group_key", "TEXT NOT NULL DEFAULT ''")
        ensure_column("discovered_job_assessments", "verdict", "TEXT NOT NULL DEFAULT 'fail'")
        ensure_column("discovered_job_assessments", "triage_dimensions_json", "TEXT NOT NULL DEFAULT '{}'")
        ensure_column("discovered_job_assessments", "coverage", "REAL NOT NULL DEFAULT 0")
        ensure_column("discovered_job_assessments", "confidence", "TEXT NOT NULL DEFAULT 'low'")
        ensure_column("discovered_job_assessments", "soft_risks_json", "TEXT NOT NULL DEFAULT '[]'")
        ensure_column("model_service_events", "response_id", "TEXT NOT NULL DEFAULT ''")

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
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON jobs(status, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_conversation ON jobs(conversation_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_job_evaluations_job ON job_evaluations(job_id, id DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_resume_versions_job ON resume_versions(job_id, id DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_resume_changes_version ON resume_changes(version_id, sort_order, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_interview_kits_job ON interview_kits(job_id, id DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_interview_tasks_kit ON interview_tasks(kit_id, sort_order, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_interview_rounds_job ON interview_rounds(job_id, scheduled_at, id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, occurred_at DESC, id DESC)")


def _apply_migrations(conn: sqlite3.Connection) -> None:
    """Apply numbered, additive 2.0 migrations transactionally.

    Development databases can still be rebuilt from scratch, but keeping the
    migration ledger makes schema drift visible and gives future releases a
    deterministic upgrade path.
    """
    migrations: list[tuple[int, str, str | Callable[[sqlite3.Connection], None]]] = [
        (2, "career_operating_system", _CAREER_OS_SCHEMA),
        (3, "career_operating_system_relations", _CAREER_OS_RELATIONS_SCHEMA),
        (4, "opportunity_discovery_runs", _OPPORTUNITY_DISCOVERY_SCHEMA),
        (5, "job_decision_evaluations", _JOB_EVALUATION_SCHEMA),
        (6, "browser_job_capture_snapshots", _BROWSER_JOB_CAPTURE_SCHEMA),
        (7, "agent_tool_call_audit", _AGENT_TOOL_CALL_AUDIT_SCHEMA),
        (8, "job_story_links", _JOB_STORY_LINKS_SCHEMA),
        (9, "candidate_memory_ledger", _CANDIDATE_MEMORY_LEDGER_SCHEMA),
        (10, "candidate_sources_compatibility", _CANDIDATE_SOURCES_COMPATIBILITY_SCHEMA),
        (11, "profiles_compatibility", _PROFILES_COMPATIBILITY_SCHEMA),
        (12, "local_user_authentication", _LOCAL_USER_AUTH_SCHEMA),
        (13, "interview_preparation_state", _INTERVIEW_PREPARATION_SCHEMA),
        (14, "resume_versions_optional_job", _migrate_resume_versions_optional_job),
        (16, "agent_run_snapshots", _AGENT_RUN_SNAPSHOT_SCHEMA),
        (17, "drop_career_weekly_reports", "DROP TABLE IF EXISTS career_weekly_reports;"),
    ]
    applied = {
        int(row["version"])
        for row in conn.execute("SELECT version FROM schema_migrations").fetchall()
    }
    for version, name, step in migrations:
        if version in applied:
            continue
        if callable(step):
            step(conn)
        else:
            conn.executescript(step)
        conn.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
            (version, name),
        )


def _migrate_resume_versions_optional_job(conn: sqlite3.Connection) -> None:
    columns = {
        row["name"]: row
        for row in conn.execute("PRAGMA table_info(resume_versions)")
    }
    job_column = columns.get("job_id")
    if job_column is None or int(job_column["notnull"]) == 0:
        return
    new_columns = (
        "id",
        "job_id",
        "profile_id",
        "evaluation_id",
        "title",
        "status",
        "template_id",
        "style_id",
        "layout_json",
        "base_content",
        "rendered_content",
        "created_at",
        "updated_at",
    )
    shared = [name for name in new_columns if name in columns]
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute(
            """
            CREATE TABLE resume_versions_v14 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER,
                profile_id INTEGER NOT NULL,
                evaluation_id INTEGER,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                template_id TEXT NOT NULL DEFAULT 'classic',
                style_id TEXT NOT NULL DEFAULT 'navy',
                layout_json TEXT NOT NULL DEFAULT '{}',
                base_content TEXT NOT NULL,
                rendered_content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
                FOREIGN KEY (evaluation_id) REFERENCES job_evaluations(id) ON DELETE SET NULL
            )
            """
        )
        conn.execute(
            f"""
            INSERT INTO resume_versions_v14 ({", ".join(shared)})
            SELECT {", ".join(shared)} FROM resume_versions
            """
        )
        conn.execute("DROP TABLE resume_versions")
        conn.execute("ALTER TABLE resume_versions_v14 RENAME TO resume_versions")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_resume_versions_job ON resume_versions(job_id, id DESC)"
        )
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


_LOCAL_USER_AUTH_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    avatar_relpath TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


_INTERVIEW_PREPARATION_SCHEMA = """
CREATE TABLE IF NOT EXISTS interview_preparation_state (
    profile_id INTEGER PRIMARY KEY,
    knowledge_revision INTEGER NOT NULL DEFAULT 0,
    node_state_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
"""


_AGENT_RUN_SNAPSHOT_SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_run_snapshots (
    conversation_id INTEGER PRIMARY KEY,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
"""


_CAREER_OS_SCHEMA = """
CREATE TABLE IF NOT EXISTS career_strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    target_roles_json TEXT NOT NULL DEFAULT '[]',
    seniority TEXT NOT NULL DEFAULT '',
    market TEXT NOT NULL DEFAULT 'cn',
    locations_json TEXT NOT NULL DEFAULT '[]',
    salary_json TEXT NOT NULL DEFAULT '{}',
    work_modes_json TEXT NOT NULL DEFAULT '[]',
    industries_json TEXT NOT NULL DEFAULT '[]',
    hard_constraints_json TEXT NOT NULL DEFAULT '[]',
    soft_preferences_json TEXT NOT NULL DEFAULT '[]',
    blocked_companies_json TEXT NOT NULL DEFAULT '[]',
    blocked_keywords_json TEXT NOT NULL DEFAULT '[]',
    title_expansions_json TEXT NOT NULL DEFAULT '[]',
    evaluation_weights_json TEXT NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS strategy_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    fact_id INTEGER,
    relationship TEXT NOT NULL DEFAULT 'supports',
    weight REAL NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (strategy_id) REFERENCES career_strategies(id) ON DELETE CASCADE,
    FOREIGN KEY (fact_id) REFERENCES candidate_facts(id) ON DELETE CASCADE,
    CHECK (relationship IN ('supports', 'gap', 'risk')),
    UNIQUE(strategy_id, fact_id, relationship)
);

CREATE TABLE IF NOT EXISTS candidate_narratives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    strategy_id INTEGER,
    headline TEXT NOT NULL DEFAULT '',
    transition_story TEXT NOT NULL DEFAULT '',
    strengths_json TEXT NOT NULL DEFAULT '[]',
    risk_explanations_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (strategy_id) REFERENCES career_strategies(id) ON DELETE CASCADE,
    CHECK (status IN ('pending', 'confirmed', 'disputed', 'retracted'))
);

CREATE TABLE IF NOT EXISTS candidate_stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    strategy_id INTEGER,
    title TEXT NOT NULL,
    situation TEXT NOT NULL DEFAULT '',
    task TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '',
    reflection TEXT NOT NULL DEFAULT '',
    competencies_json TEXT NOT NULL DEFAULT '[]',
    applicable_questions_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (strategy_id) REFERENCES career_strategies(id) ON DELETE SET NULL,
    CHECK (status IN ('pending', 'confirmed', 'disputed', 'retracted'))
);

CREATE TABLE IF NOT EXISTS candidate_story_facts (
    story_id INTEGER NOT NULL,
    fact_id INTEGER NOT NULL,
    PRIMARY KEY (story_id, fact_id),
    FOREIGN KEY (story_id) REFERENCES candidate_stories(id) ON DELETE CASCADE,
    FOREIGN KEY (fact_id) REFERENCES candidate_facts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS voice_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '默认表达风格',
    tone_rules_json TEXT NOT NULL DEFAULT '[]',
    banned_phrases_json TEXT NOT NULL DEFAULT '[]',
    warning_phrases_json TEXT NOT NULL DEFAULT '[]',
    formatting_rules_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS writing_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    source_id INTEGER,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    sample_type TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES candidate_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS profile_interview_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL,
    phase TEXT NOT NULL DEFAULT 'goals',
    status TEXT NOT NULL DEFAULT 'active',
    coverage_json TEXT NOT NULL DEFAULT '{}',
    last_question TEXT NOT NULL DEFAULT '',
    pending_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    UNIQUE(profile_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS application_stage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    strategy_id INTEGER,
    from_stage TEXT NOT NULL DEFAULT '',
    to_stage TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    note TEXT NOT NULL DEFAULT '',
    feedback_verbatim TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (strategy_id) REFERENCES career_strategies(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS interview_debriefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    round_id INTEGER,
    source_id INTEGER,
    input_source TEXT NOT NULL DEFAULT 'recall',
    summary TEXT NOT NULL DEFAULT '',
    questions_json TEXT NOT NULL DEFAULT '[]',
    strengths_json TEXT NOT NULL DEFAULT '[]',
    gaps_json TEXT NOT NULL DEFAULT '[]',
    feedback_verbatim TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (round_id) REFERENCES interview_rounds(id) ON DELETE SET NULL,
    FOREIGN KEY (source_id) REFERENCES candidate_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS interview_question_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    strategy_id INTEGER,
    question TEXT NOT NULL,
    competency TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'gap',
    times_seen INTEGER NOT NULL DEFAULT 1,
    last_job_id INTEGER,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (strategy_id) REFERENCES career_strategies(id) ON DELETE SET NULL,
    FOREIGN KEY (last_job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    canonical_name TEXT NOT NULL UNIQUE,
    website_url TEXT NOT NULL DEFAULT '',
    careers_url TEXT NOT NULL DEFAULT '',
    discovery_reason TEXT NOT NULL DEFAULT '',
    evidence_json TEXT NOT NULL DEFAULT '[]',
    legal_name TEXT NOT NULL DEFAULT '',
    unified_social_credit_code TEXT NOT NULL DEFAULT '',
    identity_status TEXT NOT NULL DEFAULT 'unknown',
    identity_evidence_json TEXT NOT NULL DEFAULT '[]',
    followed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opportunity_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    provider TEXT NOT NULL,
    source_key TEXT NOT NULL,
    source_url TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_status TEXT NOT NULL DEFAULT 'new',
    last_scanned_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    UNIQUE(provider, source_key)
);

CREATE TABLE IF NOT EXISTS opportunity_scan_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER,
    trigger TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'running',
    discovered_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    closed_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (source_id) REFERENCES opportunity_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS discovered_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER,
    external_id TEXT NOT NULL DEFAULT '',
    canonical_url TEXT NOT NULL DEFAULT '',
    company_name TEXT NOT NULL DEFAULT '',
    job_title TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    salary_text TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL,
    dedup_key TEXT NOT NULL UNIQUE,
    lifecycle_status TEXT NOT NULL DEFAULT 'discovered',
    posting_status TEXT NOT NULL DEFAULT 'active',
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES opportunity_sources(id) ON DELETE SET NULL,
    CHECK (lifecycle_status IN ('discovered', 'shortlisted', 'saved', 'dismissed')),
    CHECK (posting_status IN ('active', 'closed', 'unknown'))
);

CREATE TABLE IF NOT EXISTS discovered_job_occurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discovered_job_id INTEGER NOT NULL,
    scan_run_id INTEGER,
    content_hash TEXT NOT NULL,
    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (discovered_job_id) REFERENCES discovered_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (scan_run_id) REFERENCES opportunity_scan_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_career_strategies_profile ON career_strategies(profile_id, priority DESC, id);
CREATE INDEX IF NOT EXISTS idx_candidate_stories_profile ON candidate_stories(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_application_stage_job ON application_stage_events(job_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_discovered_jobs_status ON discovered_jobs(lifecycle_status, posting_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_sources_enabled ON opportunity_sources(enabled, last_scanned_at);
"""


_CAREER_OS_RELATIONS_SCHEMA = """
CREATE TABLE IF NOT EXISTS candidate_story_strategies (
    story_id INTEGER NOT NULL,
    strategy_id INTEGER NOT NULL,
    PRIMARY KEY (story_id, strategy_id),
    FOREIGN KEY (story_id) REFERENCES candidate_stories(id) ON DELETE CASCADE,
    FOREIGN KEY (strategy_id) REFERENCES career_strategies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_story_strategies_strategy
    ON candidate_story_strategies(strategy_id, story_id);
"""


_JOB_EVALUATION_SCHEMA = """
CREATE TABLE IF NOT EXISTS job_evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    profile_id INTEGER NOT NULL,
    strategy_id INTEGER,
    parent_evaluation_id INTEGER,
    mode TEXT NOT NULL DEFAULT 'full',
    status TEXT NOT NULL DEFAULT 'queued',
    current_stage TEXT NOT NULL DEFAULT 'queued',
    include_public_research INTEGER NOT NULL DEFAULT 1,
    research_budget INTEGER NOT NULL DEFAULT 5,
    research_query_count INTEGER NOT NULL DEFAULT 0,
    overall_score REAL,
    coverage REAL NOT NULL DEFAULT 0,
    confidence TEXT NOT NULL DEFAULT 'low',
    final_decision TEXT NOT NULL DEFAULT 'research_first',
    risk_tier TEXT NOT NULL DEFAULT 'unknown',
    hard_stops_json TEXT NOT NULL DEFAULT '[]',
    limitations_json TEXT NOT NULL DEFAULT '[]',
    summary_json TEXT NOT NULL DEFAULT '{}',
    job_fingerprint TEXT NOT NULL DEFAULT '',
    context_fingerprint TEXT NOT NULL DEFAULT '',
    weights_fingerprint TEXT NOT NULL DEFAULT '',
    knowledge_revision INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    model_name TEXT NOT NULL DEFAULT '',
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (strategy_id) REFERENCES career_strategies(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_evaluation_id) REFERENCES job_evaluations(id) ON DELETE SET NULL,
    CHECK (mode IN ('full', 'deep')),
    CHECK (status IN ('queued', 'running', 'completed', 'partial_failed', 'failed', 'cancelled', 'interrupted')),
    CHECK (confidence IN ('low', 'medium', 'high')),
    CHECK (final_decision IN ('apply', 'consider', 'research_first', 'skip')),
    CHECK (risk_tier IN ('high_confidence', 'caution', 'suspicious', 'unknown'))
);

CREATE TABLE IF NOT EXISTS job_evaluation_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER NOT NULL,
    section_key TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    confidence TEXT NOT NULL DEFAULT 'low',
    content_json TEXT NOT NULL DEFAULT '{}',
    limitations_json TEXT NOT NULL DEFAULT '[]',
    evidence_refs_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (evaluation_id) REFERENCES job_evaluations(id) ON DELETE CASCADE,
    UNIQUE(evaluation_id, section_key),
    CHECK (section_key IN ('a', 'b', 'c', 'd', 'e', 'f', 'g')),
    CHECK (status IN ('pending', 'running', 'completed', 'partial', 'failed')),
    CHECK (confidence IN ('low', 'medium', 'high'))
);

CREATE TABLE IF NOT EXISTS job_evaluation_dimensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER NOT NULL,
    dimension_key TEXT NOT NULL,
    title TEXT NOT NULL,
    score REAL,
    weight REAL NOT NULL,
    weighted_score REAL,
    status TEXT NOT NULL DEFAULT 'unknown',
    confidence TEXT NOT NULL DEFAULT 'low',
    rationale_json TEXT NOT NULL DEFAULT '[]',
    evidence_refs_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (evaluation_id) REFERENCES job_evaluations(id) ON DELETE CASCADE,
    UNIQUE(evaluation_id, dimension_key),
    CHECK (status IN ('evaluated', 'unknown', 'not_applicable')),
    CHECK (confidence IN ('low', 'medium', 'high'))
);

CREATE TABLE IF NOT EXISTS job_evaluation_requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER NOT NULL,
    requirement_key TEXT NOT NULL,
    text TEXT NOT NULL,
    requirement_type TEXT NOT NULL DEFAULT 'requirement',
    importance TEXT NOT NULL DEFAULT 'standard',
    match_status TEXT NOT NULL DEFAULT 'no_evidence',
    fact_ids_json TEXT NOT NULL DEFAULT '[]',
    adjacent_fact_ids_json TEXT NOT NULL DEFAULT '[]',
    jd_excerpt TEXT NOT NULL DEFAULT '',
    mitigation TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (evaluation_id) REFERENCES job_evaluations(id) ON DELETE CASCADE,
    UNIQUE(evaluation_id, requirement_key),
    CHECK (requirement_type IN ('responsibility', 'requirement', 'bonus')),
    CHECK (importance IN ('hard', 'core', 'standard', 'bonus')),
    CHECK (match_status IN ('matched', 'partial', 'no_evidence', 'not_applicable'))
);

CREATE TABLE IF NOT EXISTS job_evaluation_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER NOT NULL,
    source_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    query TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'third_party',
    source_tier INTEGER NOT NULL DEFAULT 2,
    excerpt TEXT NOT NULL DEFAULT '',
    published_at TEXT NOT NULL DEFAULT '',
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    content_hash TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (evaluation_id) REFERENCES job_evaluations(id) ON DELETE CASCADE,
    UNIQUE(evaluation_id, source_key)
);

CREATE TABLE IF NOT EXISTS job_evaluation_risks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER NOT NULL,
    risk_key TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    confidence REAL NOT NULL DEFAULT 0,
    observation TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    evidence_refs_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (evaluation_id) REFERENCES job_evaluations(id) ON DELETE CASCADE,
    UNIQUE(evaluation_id, risk_key),
    CHECK (severity IN ('info', 'warning', 'high', 'critical'))
);

CREATE TABLE IF NOT EXISTS job_evaluation_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER NOT NULL,
    target_type TEXT NOT NULL,
    target_key TEXT NOT NULL,
    action TEXT NOT NULL,
    override_json TEXT NOT NULL DEFAULT '{}',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (evaluation_id) REFERENCES job_evaluations(id) ON DELETE CASCADE,
    CHECK (target_type IN ('requirement', 'dimension', 'risk', 'compensation')),
    CHECK (action IN ('confirm', 'edit', 'reject', 'resolve', 'restore'))
);

CREATE TABLE IF NOT EXISTS job_research_cache (
    company_key TEXT NOT NULL,
    category TEXT NOT NULL,
    company_name TEXT NOT NULL DEFAULT '',
    sources_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (company_key, category),
    CHECK (category IN ('identity', 'market_risk'))
);

CREATE TABLE IF NOT EXISTS job_comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    weights_fingerprint TEXT NOT NULL,
    result_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (strategy_id) REFERENCES career_strategies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_comparison_entries (
    comparison_id INTEGER NOT NULL,
    evaluation_id INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    PRIMARY KEY (comparison_id, evaluation_id),
    FOREIGN KEY (comparison_id) REFERENCES job_comparisons(id) ON DELETE CASCADE,
    FOREIGN KEY (evaluation_id) REFERENCES job_evaluations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_evaluations_job ON job_evaluations(job_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_job_evaluations_status ON job_evaluations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_eval_sections_eval ON job_evaluation_sections(evaluation_id, section_key);
CREATE INDEX IF NOT EXISTS idx_job_eval_dimensions_eval ON job_evaluation_dimensions(evaluation_id, dimension_key);
CREATE INDEX IF NOT EXISTS idx_job_eval_requirements_eval ON job_evaluation_requirements(evaluation_id, id);
CREATE INDEX IF NOT EXISTS idx_job_eval_sources_eval ON job_evaluation_sources(evaluation_id, source_tier, id);
CREATE INDEX IF NOT EXISTS idx_job_eval_risks_eval ON job_evaluation_risks(evaluation_id, severity, id);
CREATE INDEX IF NOT EXISTS idx_job_eval_reviews_eval ON job_evaluation_reviews(evaluation_id, target_type, target_key, id DESC);
CREATE INDEX IF NOT EXISTS idx_job_research_cache_updated ON job_research_cache(category, updated_at DESC);
"""


_OPPORTUNITY_DISCOVERY_SCHEMA = """
CREATE TABLE IF NOT EXISTS discovery_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    trigger TEXT NOT NULL DEFAULT 'manual',
    strategy_id INTEGER,
    status TEXT NOT NULL DEFAULT 'queued',
    config_json TEXT NOT NULL DEFAULT '{}',
    total_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    succeeded_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    waiting_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (strategy_id) REFERENCES career_strategies(id) ON DELETE SET NULL,
    CHECK (mode IN ('scan', 'discover', 'company_funded', 'pipeline', 'batch')),
    CHECK (status IN ('queued', 'running', 'waiting_for_user', 'completed', 'partial_failed', 'failed', 'cancelled', 'interrupted'))
);

CREATE TABLE IF NOT EXISTS discovery_run_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    label TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'queued',
    status TEXT NOT NULL DEFAULT 'queued',
    result_json TEXT NOT NULL DEFAULT '{}',
    error_message TEXT NOT NULL DEFAULT '',
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES discovery_runs(id) ON DELETE CASCADE,
    CHECK (status IN ('queued', 'running', 'waiting_for_user', 'completed', 'failed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS discovered_job_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discovered_job_id INTEGER NOT NULL,
    strategy_id INTEGER,
    analysis_tier TEXT NOT NULL DEFAULT 'local',
    score INTEGER NOT NULL DEFAULT 0,
    recommendation TEXT NOT NULL DEFAULT 'review',
    verdict TEXT NOT NULL DEFAULT 'fail',
    triage_dimensions_json TEXT NOT NULL DEFAULT '{}',
    coverage REAL NOT NULL DEFAULT 0,
    confidence TEXT NOT NULL DEFAULT 'low',
    matched_skills_json TEXT NOT NULL DEFAULT '[]',
    evidence_gaps_json TEXT NOT NULL DEFAULT '[]',
    hard_conflicts_json TEXT NOT NULL DEFAULT '[]',
    soft_risks_json TEXT NOT NULL DEFAULT '[]',
    reasons_json TEXT NOT NULL DEFAULT '[]',
    context_fingerprint TEXT NOT NULL DEFAULT '',
    job_fingerprint TEXT NOT NULL DEFAULT '',
    knowledge_revision INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'current',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (discovered_job_id) REFERENCES discovered_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (strategy_id) REFERENCES career_strategies(id) ON DELETE SET NULL,
    CHECK (analysis_tier IN ('local', 'deep')),
    CHECK (status IN ('current', 'stale', 'failed'))
);

CREATE TABLE IF NOT EXISTS company_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    signal_type TEXT NOT NULL,
    event_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    occurred_at TEXT,
    funding_round TEXT NOT NULL DEFAULT '',
    amount_text TEXT NOT NULL DEFAULT '',
    investors_json TEXT NOT NULL DEFAULT '[]',
    source_url TEXT NOT NULL DEFAULT '',
    source_title TEXT NOT NULL DEFAULT '',
    source_excerpt TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_run_items_run ON discovery_run_items(run_id, status, id);
CREATE INDEX IF NOT EXISTS idx_discovered_assessments_job ON discovered_job_assessments(discovered_job_id, strategy_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_company_signals_company ON company_signals(company_id, occurred_at DESC, id DESC);
"""


_BROWSER_JOB_CAPTURE_SCHEMA = """
CREATE TABLE IF NOT EXISTS job_capture_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discovered_job_id INTEGER NOT NULL,
    canonical_url TEXT NOT NULL,
    platform TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    fields_json TEXT NOT NULL DEFAULT '{}',
    visible_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (discovered_job_id) REFERENCES discovered_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_capture_snapshots_job
    ON job_capture_snapshots(discovered_job_id, captured_at DESC);
"""


_AGENT_TOOL_CALL_AUDIT_SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    round INTEGER NOT NULL,
    tool_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    error_code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_tool_call_id
    ON agent_tool_calls(tool_call_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_conversation_id
    ON agent_tool_calls(conversation_id, created_at);
"""


_JOB_STORY_LINKS_SCHEMA = """
CREATE TABLE IF NOT EXISTS job_story_links (
    job_id INTEGER NOT NULL,
    story_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (job_id, story_id),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (story_id) REFERENCES candidate_stories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_job_story_links_story
    ON job_story_links(story_id, job_id);
"""


_CANDIDATE_MEMORY_LEDGER_SCHEMA = """
CREATE TABLE IF NOT EXISTS candidate_memory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    statement TEXT NOT NULL,
    canonical_key TEXT NOT NULL DEFAULT '',
    value_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'proposed',
    sensitivity TEXT NOT NULL DEFAULT 'private',
    confidence REAL NOT NULL DEFAULT 0,
    source_kind TEXT NOT NULL DEFAULT 'agent_proposal',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    superseded_by_id INTEGER,
    expires_at TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('proposed', 'confirmed', 'rejected', 'retracted', 'superseded')),
    CHECK (sensitivity IN ('public', 'private', 'sensitive')),
    FOREIGN KEY (superseded_by_id) REFERENCES candidate_memory_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS candidate_memory_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_item_id INTEGER NOT NULL,
    source_id INTEGER,
    excerpt TEXT NOT NULL DEFAULT '',
    locator TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (memory_item_id) REFERENCES candidate_memory_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS candidate_memory_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    insight_type TEXT NOT NULL,
    content_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'proposed',
    sample_size INTEGER NOT NULL DEFAULT 0,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    expires_at TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('proposed', 'confirmed', 'rejected', 'retracted'))
);

CREATE INDEX IF NOT EXISTS idx_candidate_memory_items_profile_status
    ON candidate_memory_items(profile_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidate_memory_evidence_item
    ON candidate_memory_evidence(memory_item_id, id);
CREATE INDEX IF NOT EXISTS idx_candidate_memory_insights_profile_status
    ON candidate_memory_insights(profile_id, status, updated_at DESC);
"""


_CANDIDATE_SOURCES_COMPATIBILITY_SCHEMA = """
-- Existing career-feedback tables retain this foreign key.  Profile documents
-- replaced the original source table, but keeping this lightweight registry
-- makes old databases and nullable debrief references valid during migration.
CREATE TABLE IF NOT EXISTS candidate_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL DEFAULT 1,
    source_type TEXT NOT NULL DEFAULT 'profile_document',
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


_PROFILES_COMPATIBILITY_SCHEMA = """
-- Older career tables still reference profiles(id). The user-facing profile is
-- now a Markdown document, so this table mirrors the active document solely
-- to preserve those foreign keys and legacy read paths.
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    resume_text TEXT NOT NULL DEFAULT '',
    resume_filename TEXT NOT NULL DEFAULT '',
    resume_redacted_text TEXT NOT NULL DEFAULT '',
    privacy_mode TEXT NOT NULL DEFAULT 'redacted',
    skills_json TEXT NOT NULL DEFAULT '[]',
    projects_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locale TEXT NOT NULL DEFAULT 'zh-CN',
    knowledge_revision INTEGER NOT NULL DEFAULT 0
);
"""


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

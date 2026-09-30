"""Current library storage; no career business tables."""

LIBRARY_CORE_SCHEMA = """
CREATE TABLE IF NOT EXISTS library_metadata (
 id INTEGER PRIMARY KEY CHECK(id = 1), name TEXT NOT NULL DEFAULT '用户',
 privacy_mode TEXT NOT NULL DEFAULT 'redacted' CHECK(privacy_mode IN ('redacted', 'original')),
 locale TEXT NOT NULL DEFAULT 'zh-CN', knowledge_revision INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS library_knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    library_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    statement TEXT NOT NULL,
    canonical_key TEXT NOT NULL DEFAULT '',
    value_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    sensitivity TEXT NOT NULL DEFAULT 'private',
    confidence REAL NOT NULL DEFAULT 0,
    source_kind TEXT NOT NULL DEFAULT 'agent_proposal',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    superseded_by_id INTEGER,
    expires_at TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('pending', 'confirmed', 'disputed', 'retracted', 'superseded')),
    CHECK (sensitivity IN ('public', 'private', 'sensitive')),
    FOREIGN KEY (superseded_by_id) REFERENCES library_knowledge(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS library_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id INTEGER NOT NULL,
    source_id INTEGER,
    excerpt TEXT NOT NULL DEFAULT '',
    locator TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (knowledge_id) REFERENCES library_knowledge(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_library_knowledge_status ON library_knowledge(status, id);
CREATE INDEX IF NOT EXISTS idx_library_evidence_item ON library_evidence(knowledge_id, id);
"""

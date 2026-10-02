"""One-way import of v22 library-visible data. Never called by library reads."""
from __future__ import annotations

import json
from hashlib import sha256

from ..db import connect, json_dump
from ..privacy import scan_and_redact
from . import profile_document


_STATUS = {"proposed": "pending", "rejected": "disputed"}
_EXCLUDED = {"career_goal", "career_strategy", "job_preference"}


def migrate_library(db_path) -> None:
    document = profile_document.load(db_path)
    with connect(db_path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        legacy = conn.execute("SELECT * FROM profiles ORDER BY updated_at DESC, id DESC LIMIT 1").fetchone() if "profiles" in tables else None
        if document is None and legacy is not None:
            data = dict(legacy)
            document = profile_document.ProfileDocument(
                name=data.get("name") or "用户",
                locale=data.get("locale") or "zh-CN",
                privacy_mode=data.get("privacy_mode") or "redacted",
                resume_text=data.get("resume_text") or "",
                skills="\n".join(str(value) for value in json.loads(data.get("skills_json") or "[]")),
                projects="\n".join(
                    "：".join(str(value.get(key) or "") for key in ("name", "summary")) if isinstance(value, dict) else str(value)
                    for value in json.loads(data.get("projects_json") or "[]")
                ),
                knowledge_revision=int(data.get("knowledge_revision") or 0),
            )
        if document is not None:
            conn.execute(
                """INSERT OR IGNORE INTO library_metadata (id, name, privacy_mode, locale, knowledge_revision)
                   VALUES (1, ?, ?, ?, ?)""",
                (document.name, document.privacy_mode, document.locale, document.knowledge_revision),
            )
            for fact in document.facts():
                if fact["category"] in _EXCLUDED:
                    continue
                conn.execute(
                    """INSERT OR IGNORE INTO library_knowledge
                       (id, library_id, category, statement, status, source_kind, metadata_json)
                       VALUES (?, 1, ?, ?, 'confirmed', 'legacy_document', ?)""",
                    (fact["id"], fact["category"], fact["statement"], json_dump({"legacy_section": fact["section"]})),
                )
            content = document.resume_text.strip()
            marker = "legacy_resume_text_v1"
            if content and conn.execute(
                "SELECT 1 FROM library_sources WHERE content_hash = ? OR metadata_json LIKE ?",
                (sha256(content.encode()).hexdigest(), f'%"migration_marker": "{marker}"%'),
            ).fetchone() is None:
                conn.execute(
                    """INSERT INTO library_sources
                       (source_kind, title, mime_type, content, redacted_content, privacy_mode,
                        content_hash, character_count, metadata_json)
                       VALUES ('legacy', '历史资料', 'text/plain', ?, ?, ?, ?, ?, ?)""",
                    (content, scan_and_redact(content)[1], document.privacy_mode,
                     sha256(content.encode()).hexdigest(), len(content), json_dump({"migration_marker": marker})),
                )
        if "candidate_memory_items" not in tables:
            return
        records = conn.execute("SELECT * FROM candidate_memory_items ORDER BY id").fetchall()
        for record in records:
            item = dict(record)
            conn.execute(
                """INSERT OR IGNORE INTO library_knowledge
                   (id, library_id, category, statement, canonical_key, value_json, status,
                    sensitivity, confidence, source_kind, metadata_json, expires_at,
                    reviewed_at, created_at, updated_at)
                   VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (1_000_000 + item["id"], item["category"], item["statement"], item["canonical_key"],
                 item["value_json"], _STATUS.get(item["status"], item["status"]), item["sensitivity"],
                 item["confidence"], item["source_kind"], item["metadata_json"], item["expires_at"],
                 item["reviewed_at"], item["created_at"], item["updated_at"]),
            )
        for item in records:
            if item["superseded_by_id"] is not None:
                conn.execute("UPDATE library_knowledge SET superseded_by_id = ? WHERE id = ?",
                             (1_000_000 + item["superseded_by_id"], 1_000_000 + item["id"]))
        by_id = {row["id"]: row for row in records}
        for evidence in conn.execute("SELECT * FROM candidate_memory_evidence ORDER BY id").fetchall():
            # Only current-library proposals used library source IDs directly.
            # Historical candidate-source IDs may collide; preserve their
            # locator/excerpt without falsely linking an unrelated new source.
            item = by_id.get(evidence["memory_item_id"])
            source_id = evidence["source_id"] if item and item["source_kind"] == "main_chat" else None
            if source_id is not None and conn.execute("SELECT 1 FROM library_sources WHERE id = ?", (source_id,)).fetchone() is None:
                source_id = None
            locator = evidence["locator"]
            if evidence["source_id"] is not None and source_id is None:
                locator += f" · 历史来源:{evidence['source_id']}"
            conn.execute(
                """INSERT OR IGNORE INTO library_evidence (id, knowledge_id, source_id, excerpt, locator, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (evidence["id"], 1_000_000 + evidence["memory_item_id"], source_id,
                 evidence["excerpt"], locator, evidence["created_at"]),
            )

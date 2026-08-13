from __future__ import annotations

import hashlib
import math
import re
from pathlib import Path
from typing import Any

from .db import connect, json_dump, row_to_dict


EMBEDDING_DIMENSIONS = 256


def index_document(
    source_type: str,
    source_id: str | int,
    title: str,
    content: str,
    metadata: dict[str, Any] | None = None,
    db_path: str | Path | None = None,
) -> int:
    """Index redacted/local text using a deterministic on-device hash vector."""
    chunks = _chunk_text(content)
    with connect(db_path) as conn:
        try:
            _load_vec(conn)
            vectors_available = True
        except Exception:
            # Mirrors search_knowledge and delete_document: the text rows stay
            # authoritative so keyword fallback search still has data to read
            # when the optional native vector extension is unavailable.
            vectors_available = False
        existing = conn.execute(
            "SELECT id FROM knowledge_chunks WHERE source_type = ? AND source_id = ?",
            (source_type, str(source_id)),
        ).fetchall()
        if vectors_available:
            for row in existing:
                conn.execute("DELETE FROM vec_knowledge WHERE rowid = ?", (row["id"],))
        conn.execute(
            "DELETE FROM knowledge_chunks WHERE source_type = ? AND source_id = ?",
            (source_type, str(source_id)),
        )
        for chunk in chunks:
            cursor = conn.execute(
                """
                INSERT INTO knowledge_chunks (source_type, source_id, title, content, metadata_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (source_type, str(source_id), title, chunk, json_dump(metadata or {})),
            )
            if vectors_available:
                conn.execute(
                    "INSERT INTO vec_knowledge(rowid, embedding) VALUES (?, ?)",
                    (cursor.lastrowid, _serialize(_embed(chunk))),
                )
    return len(chunks)


def search_knowledge(
    query: str,
    source_types: list[str] | None = None,
    limit: int = 5,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    if not query.strip():
        return []
    with connect(db_path) as conn:
        try:
            _load_vec(conn)
            candidates = conn.execute(
                """
                SELECT chunks.*, v.distance
                FROM vec_knowledge v JOIN knowledge_chunks chunks ON chunks.id = v.rowid
                WHERE v.embedding MATCH ? AND k = ?
                ORDER BY v.distance
                """,
                (_serialize(_embed(query)), max(limit * 4, 12)),
            ).fetchall()
        except Exception:
            # Safe fallback for environments where native extension loading is disabled.
            candidates = conn.execute(
                "SELECT *, 1.0 AS distance FROM knowledge_chunks WHERE content LIKE ? LIMIT ?",
                (f"%{query.strip()}%", max(limit * 4, 12)),
            ).fetchall()
    allowed = set(source_types or [])
    rows = [row_to_dict(row) for row in candidates if not allowed or row["source_type"] in allowed]
    return [
        {
            **row,
            "similarity": round(max(0.0, 1.0 - float(row.pop("distance", 1.0))), 4),
        }
        for row in rows[:limit]
    ]


def delete_document(
    source_type: str,
    source_id: str | int,
    db_path: str | Path | None = None,
) -> int:
    """Delete a source document and its vector rows from the local knowledge store."""
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id FROM knowledge_chunks WHERE source_type = ? AND source_id = ?",
            (source_type, str(source_id)),
        ).fetchall()
        row_ids = [row["id"] for row in rows]
        if row_ids:
            try:
                _load_vec(conn)
                conn.executemany(
                    "DELETE FROM vec_knowledge WHERE rowid = ?",
                    ((row_id,) for row_id in row_ids),
                )
            except Exception:
                # The text rows remain authoritative when the optional native
                # vector extension is unavailable on the current machine.
                pass
        conn.execute(
            "DELETE FROM knowledge_chunks WHERE source_type = ? AND source_id = ?",
            (source_type, str(source_id)),
        )
    return len(row_ids)


def _load_vec(conn) -> None:
    import sqlite_vec

    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.execute(
        f"CREATE VIRTUAL TABLE IF NOT EXISTS vec_knowledge USING vec0(embedding float[{EMBEDDING_DIMENSIONS}])"
    )


def _serialize(vector: list[float]) -> bytes:
    import sqlite_vec

    return sqlite_vec.serialize_float32(vector)


def _embed(text: str) -> list[float]:
    vector = [0.0] * EMBEDDING_DIMENSIONS
    terms = re.findall(r"[a-zA-Z][a-zA-Z0-9.+#-]*|[\u4e00-\u9fff]{1,4}", text.lower())
    for term in terms:
        digest = hashlib.blake2b(term.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % EMBEDDING_DIMENSIONS
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


def _chunk_text(text: str, max_chars: int = 900) -> list[str]:
    paragraphs = [item.strip() for item in re.split(r"\n{2,}", text) if item.strip()]
    if not paragraphs and text.strip():
        paragraphs = [text.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 1 > max_chars:
            chunks.append(current)
            current = ""
        while len(paragraph) > max_chars:
            chunks.append(paragraph[:max_chars])
            paragraph = paragraph[max_chars:]
        current = f"{current}\n{paragraph}".strip()
    if current:
        chunks.append(current)
    return chunks[:200]

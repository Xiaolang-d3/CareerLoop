from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..db import connect, json_dump, row_to_dict
from .embeddings import EmbeddingSpec, get_embedder


def index_document(
    source_type: str,
    source_id: str | int,
    title: str,
    content: str,
    metadata: dict[str, Any] | None = None,
    db_path: str | Path | None = None,
) -> int:
    """Index redacted/local text with the current on-device embedder."""
    chunks = _chunk_text(content)
    embedder = get_embedder()
    with connect(db_path) as conn:
        vectors_available = _ensure_vectors(conn)
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
        vectors = embedder.embed_many(chunks) if vectors_available else []
        for chunk, vector in zip(chunks, vectors or [None] * len(chunks)):
            cursor = conn.execute(
                """
                INSERT INTO knowledge_chunks (source_type, source_id, title, content, metadata_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (source_type, str(source_id), title, chunk, json_dump(metadata or {})),
            )
            if vectors_available and vector is not None:
                conn.execute(
                    "INSERT INTO vec_knowledge(rowid, embedding) VALUES (?, ?)",
                    (cursor.lastrowid, _serialize(vector)),
                )
    return len(chunks)


def index_chunks(
    source_type: str,
    source_id: str | int,
    chunks: list[dict[str, Any]],
    db_path: str | Path | None = None,
) -> int:
    """Index pre-cut text blocks, preserving caller metadata such as block_id."""
    items = [
        item for item in chunks
        if str(item.get("content") or "").strip()
    ]
    if not items:
        delete_document(source_type, source_id, db_path)
        return 0
    embedder = get_embedder()
    with connect(db_path) as conn:
        vectors_available = _ensure_vectors(conn)
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
        contents = [str(item["content"]) for item in items]
        vectors = embedder.embed_many(contents) if vectors_available else []
        for item, vector in zip(items, vectors or [None] * len(items)):
            cursor = conn.execute(
                """
                INSERT INTO knowledge_chunks (source_type, source_id, title, content, metadata_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    source_type,
                    str(source_id),
                    str(item.get("title") or "")[:200],
                    str(item["content"]),
                    json_dump(item.get("metadata") or {}),
                ),
            )
            if vectors_available and vector is not None:
                conn.execute(
                    "INSERT INTO vec_knowledge(rowid, embedding) VALUES (?, ?)",
                    (cursor.lastrowid, _serialize(vector)),
                )
    return len(items)


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
            if not _ensure_vectors(conn):
                raise RuntimeError("vector extension unavailable")
            candidates = conn.execute(
                """
                SELECT chunks.*, v.distance
                FROM vec_knowledge v JOIN knowledge_chunks chunks ON chunks.id = v.rowid
                WHERE v.embedding MATCH ? AND k = ?
                ORDER BY v.distance
                """,
                (_serialize(get_embedder().embed(query)), max(limit * 4, 12)),
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


def list_knowledge_chunks(
    source_types: list[str] | None = None,
    limit: int = 10,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    """按写入顺序读取分块原文，供检索未命中时兜底返回。"""
    with connect(db_path) as conn:
        if source_types:
            placeholders = ", ".join("?" for _ in source_types)
            rows = conn.execute(
                "SELECT * FROM knowledge_chunks WHERE source_type IN "
                f"({placeholders}) ORDER BY id LIMIT ?",
                (*source_types, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM knowledge_chunks ORDER BY id LIMIT ?",
                (limit,),
            ).fetchall()
    return [row_to_dict(row) for row in rows]


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
                _load_sqlite_vec(conn)
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


def rebuild_knowledge_index(db_path: str | Path | None = None) -> dict[str, Any]:
    """Drop and rebuild vec_knowledge from stored chunk text."""
    spec = get_embedder().spec
    with connect(db_path) as conn:
        try:
            _load_sqlite_vec(conn)
        except Exception as exc:
            return {
                "rebuilt": False,
                "reason": str(exc),
                "chunks": 0,
                **_spec_payload(spec),
            }
        conn.execute("DROP TABLE IF EXISTS knowledge_index_meta")
        conn.execute("DROP TABLE IF EXISTS vec_knowledge")
        rebuilt = _ensure_vectors(conn)
        chunks = conn.execute("SELECT COUNT(*) AS count FROM knowledge_chunks").fetchone()["count"]
    return {
        "rebuilt": rebuilt,
        "reason": "" if rebuilt else "vector extension unavailable",
        "chunks": int(chunks),
        **_spec_payload(spec),
    }


def knowledge_index_info(db_path: str | Path | None = None) -> dict[str, Any]:
    spec = get_embedder().spec
    with connect(db_path) as conn:
        stored = None
        try:
            stored = _read_meta(conn)
        except Exception:
            stored = None
        return {
            **_spec_payload(spec),
            "stored": stored,
            "table_dimensions": _vec_table_dimensions(conn),
        }


def _ensure_vectors(conn) -> bool:
    try:
        _load_sqlite_vec(conn)
    except Exception:
        return False
    spec = get_embedder().spec
    _ensure_meta_table(conn)
    existing_dim = _vec_table_dimensions(conn)
    stored = _read_meta(conn)
    needs_rebuild = (
        existing_dim != spec.dimensions
        or stored is None
        or stored["backend"] != spec.backend
        or stored["model"] != spec.model
        or int(stored["dimensions"]) != spec.dimensions
    )
    if needs_rebuild:
        if existing_dim is not None:
            conn.execute("DROP TABLE IF EXISTS vec_knowledge")
        conn.execute(
            f"CREATE VIRTUAL TABLE vec_knowledge USING vec0(embedding float[{spec.dimensions}])"
        )
        _reembed_all(conn, spec)
        _write_meta(conn, spec)
    return True


def _reembed_all(conn, spec: EmbeddingSpec) -> None:
    rows = conn.execute("SELECT id, content FROM knowledge_chunks").fetchall()
    if not rows:
        return
    vectors = get_embedder().embed_many([row["content"] for row in rows])
    if len(vectors) != len(rows):
        raise RuntimeError("embedding count does not match knowledge chunks")
    if any(len(vector) != spec.dimensions for vector in vectors):
        raise RuntimeError("embedding dimension does not match the current index")
    for row, vector in zip(rows, vectors):
        conn.execute(
            "INSERT INTO vec_knowledge(rowid, embedding) VALUES (?, ?)",
            (row["id"], _serialize(vector)),
        )


def _load_sqlite_vec(conn) -> None:
    import sqlite_vec

    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)


def _ensure_meta_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS knowledge_index_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            backend TEXT NOT NULL,
            model TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _read_meta(conn) -> dict[str, Any] | None:
    try:
        row = conn.execute(
            "SELECT backend, model, dimensions FROM knowledge_index_meta WHERE id = 1"
        ).fetchone()
    except Exception:
        return None
    return dict(row) if row else None


def _write_meta(conn, spec: EmbeddingSpec) -> None:
    _ensure_meta_table(conn)
    conn.execute(
        """
        INSERT INTO knowledge_index_meta (id, backend, model, dimensions, updated_at)
        VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            backend = excluded.backend,
            model = excluded.model,
            dimensions = excluded.dimensions,
            updated_at = CURRENT_TIMESTAMP
        """,
        (spec.backend, spec.model, spec.dimensions),
    )


def _vec_table_dimensions(conn) -> int | None:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE name = 'vec_knowledge'"
    ).fetchone()
    if not row or not row["sql"]:
        return None
    match = re.search(r"float\[(\d+)\]", row["sql"])
    return int(match.group(1)) if match else None


def _serialize(vector: list[float]) -> bytes:
    import sqlite_vec

    return sqlite_vec.serialize_float32(vector)


def _spec_payload(spec: EmbeddingSpec) -> dict[str, Any]:
    return {
        "backend": spec.backend,
        "model": spec.model,
        "dimensions": spec.dimensions,
    }


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

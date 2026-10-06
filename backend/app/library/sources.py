"""Independent local sources; current reads never revisit legacy storage."""
from __future__ import annotations

import json
import mimetypes
import os
import re
from hashlib import sha256
from pathlib import Path
from typing import Any

from ..db import connect, json_dump, row_to_dict
from ..knowledge import delete_document, index_document
from ..privacy import scan_and_redact
from ..workspace import resolve_document_dir
from ..documents.service import parse_document_upload


SOURCE_TYPE = "library_source"


def _clean_title(value: str, fallback: str = "未命名资料") -> str:
    return " ".join(value.split())[:255] or fallback


def _safe_filename(value: str) -> str:
    name = Path(value).name.strip()[:255] or "document"
    safe = re.sub(r"[^\w.()\-\u4e00-\u9fff ]+", "_", name, flags=re.UNICODE)
    return safe.strip(". ") or "document"


def _library_root(db_path: str | Path | None = None) -> Path:
    root = resolve_document_dir(db_path) / "library"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        root.chmod(0o700)
    except OSError:
        pass
    return root


def _source_dir(source_id: int, db_path: str | Path | None = None) -> Path:
    directory = _library_root(db_path) / str(source_id)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        directory.chmod(0o700)
    except OSError:
        pass
    return directory


def _model_content(source: dict[str, Any]) -> str:
    return str(
        source.get("content")
        if source.get("privacy_mode") == "original"
        else source.get("redacted_content")
        or ""
    )


def _index_source(source: dict[str, Any], db_path: str | Path | None = None) -> None:
    source_id = int(source["id"])
    if not source.get("enabled") or source.get("parse_status") != "ready" or source.get("trashed_at"):
        delete_document(SOURCE_TYPE, source_id, db_path=db_path)
        return
    content = _model_content(source).strip()
    if not content:
        delete_document(SOURCE_TYPE, source_id, db_path=db_path)
        return
    index_document(
        SOURCE_TYPE,
        source_id,
        str(source.get("title") or "资料"),
        content,
        metadata={
            "source_id": source_id,
            "title": source.get("title") or "资料",
            "privacy_mode": source.get("privacy_mode") or "redacted",
        },
        db_path=db_path,
    )


def _source_from_row(row: Any) -> dict[str, Any]:
    source = row_to_dict(row) or {}
    source["enabled"] = bool(source.get("enabled"))
    source["character_count"] = int(source.get("character_count") or 0)
    organization = (source.get("metadata") or {}).get("organization") or {}
    source.update({key: organization.get(key) for key in ("folder_id", "trashed_at", "last_opened_at")})
    source["favorite"] = bool(organization.get("favorite"))
    return source


def _summary(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(source["id"]),
        "source_kind": source.get("source_kind") or "upload",
        "title": source.get("title") or "资料",
        "original_filename": source.get("original_filename") or "",
        "mime_type": source.get("mime_type") or "application/octet-stream",
        "source_uri": source.get("source_uri") or "",
        "privacy_mode": source.get("privacy_mode") or "redacted",
        "enabled": bool(source.get("enabled")),
        "parse_status": source.get("parse_status") or "ready",
        "character_count": int(source.get("character_count") or 0),
        "file_available": bool(source.get("stored_path")),
        "created_at": source.get("created_at") or "",
        "updated_at": source.get("updated_at") or "",
        "folder_id": source.get("folder_id"),
        "favorite": bool(source.get("favorite")),
        "trashed_at": source.get("trashed_at"),
        "last_opened_at": source.get("last_opened_at"),
        "size_bytes": (source.get("metadata") or {}).get("size_bytes", 0),
    }


def list_sources(db_path: str | Path | None = None) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM library_sources ORDER BY updated_at DESC, id DESC"
        ).fetchall()
    return [_summary(_source_from_row(row)) for row in rows]


def get_source(
    source_id: int,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM library_sources WHERE id = ?", (source_id,)
        ).fetchone()
    if row is None:
        raise ValueError("资料来源不存在")
    source = _source_from_row(row)
    return {
        **_summary(source),
        "content": str(source.get("content") or ""),
        "redacted_content": str(source.get("redacted_content") or ""),
        "metadata": source.get("metadata") if isinstance(source.get("metadata"), dict) else {},
    }


def create_text_source(
    *,
    title: str,
    content: str,
    privacy_mode: str = "redacted",
    source_uri: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    clean_content = content.strip()
    if not clean_content:
        raise ValueError("资料内容不能为空")
    if privacy_mode not in {"redacted", "original"}:
        raise ValueError("隐私模式不合法")
    redacted = scan_and_redact(clean_content)[1]
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO library_sources (
                source_kind, title, mime_type, source_uri, content,
                redacted_content, privacy_mode, enabled, parse_status,
                content_hash, character_count, metadata_json
            ) VALUES ('paste', ?, 'text/plain', ?, ?, ?, ?, 1, 'ready', ?, ?, '{}')
            """,
            (
                _clean_title(title),
                source_uri.strip()[:2000],
                clean_content,
                redacted,
                privacy_mode,
                sha256(clean_content.encode("utf-8")).hexdigest(),
                len(clean_content),
            ),
        )
        source_id = int(cursor.lastrowid)
    source = get_source(source_id, db_path=db_path)
    _index_source(source, db_path)
    return source


def import_file_source(
    *,
    filename: str,
    content_bytes: bytes,
    mode: str = "fast",
    privacy_mode: str = "redacted",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if not content_bytes:
        raise ValueError("资料文件不能为空")
    if privacy_mode not in {"redacted", "original"}:
        raise ValueError("隐私模式不合法")
    safe_name = _safe_filename(filename)
    try:
        parsed = parse_document_upload(safe_name, content_bytes, mode)
        extracted = str(parsed.get("text") or "").strip()
    except Exception:
        # The original is the file library's durable record; extraction is optional.
        parsed = {"warnings": ["文字提取失败，原文件已保存，可预览或下载。"]}
        extracted = ""
    redacted = str(parsed.get("redacted_text") or scan_and_redact(extracted)[1])
    mime_type = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    digest = sha256(content_bytes).hexdigest()
    metadata = {
        "parser": parsed.get("parser") or "unknown",
        "warnings": parsed.get("warnings") or [],
        "size_bytes": len(content_bytes),
    }
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO library_sources (
                source_kind, title, original_filename, mime_type, content,
                redacted_content, privacy_mode, enabled, parse_status,
                content_hash, character_count, metadata_json
            ) VALUES ('upload', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
            """,
            (
                _clean_title(Path(safe_name).stem),
                safe_name,
                mime_type,
                extracted,
                redacted,
                privacy_mode,
                "ready" if extracted else "failed",
                digest,
                len(extracted),
                json_dump(metadata),
            ),
        )
        source_id = int(cursor.lastrowid)
    directory = _source_dir(source_id, db_path)
    stored = directory / safe_name
    try:
        stored.write_bytes(content_bytes)
        stored.chmod(0o600)
        relative = stored.relative_to(resolve_document_dir(db_path)).as_posix()
        with connect(db_path) as conn:
            conn.execute(
                "UPDATE library_sources SET stored_path = ? WHERE id = ?",
                (relative, source_id),
            )
    except Exception:
        with connect(db_path) as conn:
            conn.execute("DELETE FROM library_sources WHERE id = ?", (source_id,))
        try:
            stored.unlink(missing_ok=True)
            directory.rmdir()
        except OSError:
            pass
        raise
    source = get_source(source_id, db_path=db_path)
    _index_source(source, db_path)
    return source


def update_source(
    source_id: int,
    *,
    title: str | None = None,
    content: str | None = None,
    privacy_mode: str | None = None,
    enabled: bool | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    current = get_source(source_id, db_path=db_path)
    next_title = _clean_title(title, current["title"]) if title is not None else current["title"]
    next_privacy = privacy_mode or current["privacy_mode"]
    if next_privacy not in {"redacted", "original"}:
        raise ValueError("隐私模式不合法")
    next_enabled = current["enabled"] if enabled is None else enabled
    next_content = current["content"] if content is None else content.strip()
    if content is not None and not next_content:
        raise ValueError("资料内容不能为空")
    if len(next_content) > 200_000:
        raise ValueError("资料内容不能超过 20 万字")
    next_redacted = current["redacted_content"] if content is None else scan_and_redact(next_content)[1]
    next_hash = (
        sha256(next_content.encode("utf-8")).hexdigest()
        if content is not None else None
    )
    metadata = dict(current["metadata"])
    if content is not None and current["source_kind"] == "upload":
        metadata["content_edited"] = True
    with connect(db_path) as conn:
        conn.execute(
            """
            UPDATE library_sources
            SET title = ?, content = ?, redacted_content = ?,
                content_hash = COALESCE(?, content_hash), character_count = ?,
                metadata_json = ?, privacy_mode = ?, enabled = ?,
                parse_status = CASE WHEN ? IS NOT NULL THEN 'ready' ELSE parse_status END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                next_title, next_content, next_redacted, next_hash,
                len(next_content), json_dump(metadata), next_privacy,
                int(next_enabled), content, source_id,
            ),
        )
    source = get_source(source_id, db_path=db_path)
    _index_source(source, db_path)
    return source


def _stored_file(source: dict[str, Any], db_path: str | Path | None = None) -> Path | None:
    relative = str(source.get("stored_path") or "")
    if not relative:
        return None
    root = resolve_document_dir(db_path).resolve()
    candidate = (root / relative).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("资料文件路径无效")
    return candidate


def get_source_file(source_id: int, db_path: str | Path | None = None) -> tuple[Path, str, str]:
    source = get_source(source_id, db_path=db_path)
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT stored_path FROM library_sources WHERE id = ?", (source_id,)
        ).fetchone()
    stored = _stored_file({"stored_path": row["stored_path"] if row else ""}, db_path)
    if stored is None or not stored.is_file():
        raise ValueError("该来源没有可用原文件")
    return stored, source["original_filename"] or stored.name, source["mime_type"]


def delete_source(source_id: int, db_path: str | Path | None = None) -> bool:
    stored: Path | None = None
    original: bytes | None = None
    try:
        with connect(db_path) as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM library_sources WHERE id = ?", (source_id,)
            ).fetchone()
            if row is None:
                raise ValueError("资料来源不存在")
            source = _source_from_row(row)
            stored = _stored_file(source, db_path)
            original = stored.read_bytes() if stored is not None and stored.is_file() else None
            evidence = conn.execute(
                """
                SELECT e.id, e.knowledge_id, i.status
                FROM library_evidence e
                JOIN library_knowledge i ON i.id = e.knowledge_id
                WHERE e.source_id = ?
                """,
                (source_id,),
            ).fetchall()
            for item in evidence:
                memory_id = int(item["knowledge_id"])
                if item["status"] == "pending":
                    conn.execute("DELETE FROM library_evidence WHERE id = ?", (item["id"],))
                    remaining = conn.execute(
                        "SELECT 1 FROM library_evidence WHERE knowledge_id = ? LIMIT 1",
                        (memory_id,),
                    ).fetchone()
                    if remaining is None:
                        conn.execute("DELETE FROM library_knowledge WHERE id = ?", (memory_id,))
                else:
                    conn.execute(
                        """
                        UPDATE library_evidence
                        SET source_id = NULL,
                            locator = CASE WHEN locator = '' THEN '原来源已删除'
                              ELSE locator || ' · 原来源已删除' END
                        WHERE id = ?
                        """,
                        (item["id"],),
                    )
            conn.execute("DELETE FROM library_sources WHERE id = ?", (source_id,))
            delete_document(SOURCE_TYPE, source_id, db_path=db_path, connection=conn)
            if stored is not None:
                try:
                    stored.unlink(missing_ok=True)
                except OSError as exc:
                    raise ValueError("无法删除原文件，请检查文件权限后重试") from exc
    except Exception:
        if stored is not None and original is not None and not stored.exists():
            stored.write_bytes(original)
            stored.chmod(0o600)
        raise
    if stored is not None:
        try:
            stored.parent.rmdir()
        except OSError:
            # Empty directory cleanup is optional; original-file deletion is not.
            pass
    return True


def enabled_source_details(db_path: str | Path | None = None) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT * FROM library_sources
            WHERE enabled = 1 AND parse_status = 'ready'
            ORDER BY updated_at DESC, id DESC
            """
        ).fetchall()
    return [source for row in rows if not (source := _source_from_row(row)).get("trashed_at")]

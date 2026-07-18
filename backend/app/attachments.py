from __future__ import annotations

import hashlib
import mimetypes
import shutil
import uuid
from dataclasses import dataclass
from datetime import timedelta
from io import BytesIO
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from .config import get_settings
from .db import DATA_DIR, connect, json_dump, row_to_dict, rows_to_dicts

AttachmentKind = Literal["job_screenshot", "resume"]

MAX_BYTES: dict[AttachmentKind, int] = {"job_screenshot": 10 * 1024 * 1024, "resume": 8 * 1024 * 1024}
ALLOWED_SUFFIXES: dict[AttachmentKind, set[str]] = {
    "job_screenshot": {".png", ".jpg", ".jpeg", ".webp"},
    "resume": {".pdf", ".docx", ".txt", ".md"},
}


@dataclass(frozen=True)
class StoredAttachment:
    object_key: str
    content_type: str
    size_bytes: int
    sha256: str


def validate_attachment(kind: AttachmentKind, filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES[kind]:
        raise ValueError(f"该附件类型不支持 {suffix or '无扩展名'} 文件")
    if not content:
        raise ValueError("附件文件为空")
    if len(content) > MAX_BYTES[kind]:
        raise ValueError(f"附件不能超过 {MAX_BYTES[kind] // 1024 // 1024}MB")
    if kind == "job_screenshot":
        try:
            from PIL import Image
            with Image.open(BytesIO(content)) as image:
                actual_format = image.format
                image.verify()
            allowed_formats = {
                ".png": "PNG",
                ".jpg": "JPEG",
                ".jpeg": "JPEG",
                ".webp": "WEBP",
            }
            if actual_format != allowed_formats[suffix]:
                raise ValueError("图片扩展名与实际文件格式不一致")
        except Exception as exc:
            if isinstance(exc, ValueError):
                raise
            raise ValueError("无法识别该图片文件") from exc
    return suffix


class AttachmentStore:
    """Private object storage with a local fallback for development."""

    def __init__(self, local_root: Path | None = None) -> None:
        self.settings = get_settings()
        self.local_root = local_root or DATA_DIR / "attachments"

    def put(self, attachment_id: str, filename: str, content: bytes) -> StoredAttachment:
        suffix = Path(filename).suffix.lower()
        object_key = f"{attachment_id[:2]}/{attachment_id}{suffix}"
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        if self.settings.attachment_storage == "minio":
            client = self._minio_client()
            if not client.bucket_exists(self.settings.minio_bucket):
                client.make_bucket(self.settings.minio_bucket)
            client.put_object(self.settings.minio_bucket, object_key, BytesIO(content), len(content), content_type=content_type)
        else:
            path = self.local_root / object_key
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                self.local_root.mkdir(parents=True, exist_ok=True, mode=0o700)
                self.local_root.chmod(0o700)
                path.parent.chmod(0o700)
            except OSError:
                pass
            path.write_bytes(content)
            try:
                path.chmod(0o600)
            except OSError:
                pass
        return StoredAttachment(object_key, content_type, len(content), hashlib.sha256(content).hexdigest())

    def get(self, object_key: str) -> bytes:
        if self.settings.attachment_storage == "minio":
            response = self._minio_client().get_object(self.settings.minio_bucket, object_key)
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()
        return (self.local_root / object_key).read_bytes()

    def delete(self, object_key: str) -> None:
        if self.settings.attachment_storage == "minio":
            self._minio_client().remove_object(self.settings.minio_bucket, object_key)
            return
        path = self.local_root / object_key
        path.unlink(missing_ok=True)
        if path.parent != self.local_root and path.parent.exists() and not any(path.parent.iterdir()):
            shutil.rmtree(path.parent)

    def presigned_get_url(self, object_key: str, expires_seconds: int | None = None) -> str:
        if self.settings.attachment_storage != "minio":
            raise RuntimeError("图片直传需要先启用 MinIO 私有对象存储")
        if not self.settings.minio_public_endpoint:
            raise RuntimeError("图片直传需要配置可被模型网关访问的 MINIO_PUBLIC_ENDPOINT")
        expires = timedelta(seconds=expires_seconds or self.settings.attachment_vision_url_ttl_seconds)
        return self._minio_client(endpoint=self.settings.minio_public_endpoint).presigned_get_object(
            self.settings.minio_bucket,
            object_key,
            expires=expires,
        )

    def _minio_client(self, endpoint: str | None = None):
        target_endpoint = endpoint or self.settings.minio_endpoint
        if not (target_endpoint and self.settings.minio_access_key and self.settings.minio_secret_key):
            raise RuntimeError("未完成 MinIO 配置，请检查 MINIO_ENDPOINT、MINIO_ACCESS_KEY 和 MINIO_SECRET_KEY")
        try:
            from minio import Minio
        except ImportError as exc:
            raise RuntimeError("缺少 minio 依赖，请重新安装 backend/requirements.txt") from exc
        parsed = urlparse(target_endpoint if "://" in target_endpoint else f"http://{target_endpoint}")
        secure = parsed.scheme == "https" if endpoint else self.settings.minio_secure
        return Minio(
            parsed.netloc or parsed.path,
            access_key=self.settings.minio_access_key,
            secret_key=self.settings.minio_secret_key,
            secure=secure,
        )


def get_attachment_store() -> AttachmentStore:
    return AttachmentStore()


def _safe_attachment(row: dict[str, Any]) -> dict[str, Any]:
    """Return attachment metadata without an object-store path or signed URL."""
    return {
        key: value
        for key, value in row.items()
        if key not in {"object_key"}
    }


def create_attachment(
    conversation_id: int,
    kind: AttachmentKind,
    filename: str,
    content: bytes,
    *,
    db_path: str | Path | None = None,
    store: AttachmentStore | None = None,
) -> dict[str, Any]:
    validate_attachment(kind, filename, content)
    attachment_id = uuid.uuid4().hex
    attachment_store = store or get_attachment_store()
    stored = attachment_store.put(attachment_id, filename, content)
    try:
        with connect(db_path) as conn:
            conversation = conn.execute(
                "SELECT id FROM conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
            if conversation is None:
                raise ValueError("对话不存在")
            conn.execute(
                """
                INSERT INTO attachments (
                    id, conversation_id, kind, object_key, original_filename,
                    content_type, size_bytes, sha256
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    attachment_id,
                    conversation_id,
                    kind,
                    stored.object_key,
                    Path(filename).name[:255],
                    stored.content_type,
                    stored.size_bytes,
                    stored.sha256,
                ),
            )
            row = conn.execute("SELECT * FROM attachments WHERE id = ?", (attachment_id,)).fetchone()
    except Exception:
        attachment_store.delete(stored.object_key)
        raise
    return _safe_attachment(row_to_dict(row) or {})


def get_attachment(
    attachment_id: str, *, db_path: str | Path | None = None
) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM attachments WHERE id = ?", (attachment_id,)).fetchone()
    return row_to_dict(row)


def list_attachments(
    conversation_id: int, *, db_path: str | Path | None = None
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM attachments WHERE conversation_id = ? ORDER BY created_at ASC",
            (conversation_id,),
        ).fetchall()
    return [_safe_attachment(row) for row in rows_to_dicts(rows)]


def parse_attachment(
    attachment_id: str,
    *,
    mode: str = "fast",
    db_path: str | Path | None = None,
    store: AttachmentStore | None = None,
) -> dict[str, Any]:
    attachment = get_attachment(attachment_id, db_path=db_path)
    if attachment is None:
        raise ValueError("附件不存在")
    attachment_store = store or get_attachment_store()
    try:
        content = attachment_store.get(attachment["object_key"])
        if attachment["kind"] == "job_screenshot":
            from .job_import import extract_screenshot_text

            text = extract_screenshot_text(attachment["original_filename"], content)
            redacted_text = text
            metadata = {
                "parser": "local_ocr",
                "character_count": len(text),
                "requires_confirmation": True,
            }
        else:
            from .privacy import scan_and_redact
            from .profile_intelligence import extract_skills
            from .resume_parser import parse_resume_result

            parsed = parse_resume_result(attachment["original_filename"], content, mode)
            findings, redacted_text = scan_and_redact(parsed.text)
            text = parsed.text
            metadata = {
                "parser": parsed.parser,
                "character_count": len(text),
                "privacy_findings": findings,
                "suggested_skills": extract_skills(text),
                "warnings": parsed.warnings,
            }
    except Exception as exc:
        with connect(db_path) as conn:
            conn.execute(
                "UPDATE attachments SET parse_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (attachment_id,),
            )
        if isinstance(exc, ValueError):
            raise
        raise ValueError("附件解析失败，请确认文件未损坏且内容可识别") from exc

    with connect(db_path) as conn:
        conn.execute(
            """
            UPDATE attachments
            SET parse_status = 'parsed', parsed_text = ?, redacted_text = ?,
                metadata_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (text, redacted_text, json_dump(metadata), attachment_id),
        )
        row = conn.execute("SELECT * FROM attachments WHERE id = ?", (attachment_id,)).fetchone()
    return _safe_attachment(row_to_dict(row) or {})


def prepare_attachment_vision_url(
    attachment_id: str,
    *,
    db_path: str | Path | None = None,
    store: AttachmentStore | None = None,
) -> str:
    attachment = get_attachment(attachment_id, db_path=db_path)
    if attachment is None:
        raise ValueError("附件不存在")
    if attachment["kind"] != "job_screenshot":
        raise ValueError("只有岗位截图支持模型直看图片")
    settings = get_settings()
    if not settings.attachment_vision_enabled:
        raise RuntimeError("图片直传未启用，请先配置 ATTACHMENT_VISION_ENABLED=true")
    signed_url = (store or get_attachment_store()).presigned_get_url(attachment["object_key"])
    with connect(db_path) as conn:
        conn.execute(
            """
            UPDATE attachments
            SET vision_status = 'consented', vision_consent_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (attachment_id,),
        )
    return signed_url


def delete_attachment(
    attachment_id: str,
    *,
    db_path: str | Path | None = None,
    store: AttachmentStore | None = None,
) -> bool:
    attachment = get_attachment(attachment_id, db_path=db_path)
    if attachment is None:
        return False
    (store or get_attachment_store()).delete(attachment["object_key"])
    with connect(db_path) as conn:
        conn.execute("DELETE FROM attachments WHERE id = ?", (attachment_id,))
    return True


def delete_conversation_attachments(
    conversation_id: int,
    *,
    db_path: str | Path | None = None,
    store: AttachmentStore | None = None,
) -> int:
    attachment_store = store or get_attachment_store()
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id FROM attachments WHERE conversation_id = ? ORDER BY created_at ASC",
            (conversation_id,),
        ).fetchall()
    deleted = 0
    for row in rows:
        if delete_attachment(
            row["id"],
            db_path=db_path,
            store=attachment_store,
        ):
            deleted += 1
    return deleted

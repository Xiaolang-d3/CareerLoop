from __future__ import annotations

import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal
from urllib.parse import urlparse

from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .db import connect, json_dump, rows_to_dicts
from .knowledge import index_document


MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024
SUPPORTED_SCREENSHOT_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


class ManualJobImport(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    consent: Literal[True]
    input_method: Literal["paste", "screenshot"] = "paste"
    source_url: str = Field(default="", max_length=2000)
    title: str = Field(min_length=1, max_length=200)
    company: str = Field(min_length=1, max_length=200)
    location: str = Field(default="", max_length=200)
    salary_text: str = Field(default="", max_length=100)
    experience: str = Field(default="", max_length=200)
    education: str = Field(default="", max_length=100)
    industry: str = Field(default="", max_length=200)
    company_size: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=30_000)
    conversation_id: int | None = Field(default=None, ge=1)

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: str) -> str:
        if not value:
            return value
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("岗位链接必须是有效的 HTTP 或 HTTPS 地址")
        return value


def _manual_source_url(payload: ManualJobImport) -> str:
    if payload.source_url:
        return payload.source_url
    digest = hashlib.sha256(
        "\n".join((payload.title, payload.company, payload.description)).encode("utf-8")
    ).hexdigest()[:24]
    return f"manual://job/{digest}"


def import_manual_job(
    payload: ManualJobImport,
    db_path: str | Path | None = None,
) -> dict:
    source_url = _manual_source_url(payload)
    location_parts = payload.location.split(maxsplit=1)
    city = location_parts[0] if location_parts else ""
    district = location_parts[1] if len(location_parts) > 1 else ""
    raw = {
        "imported_via": f"manual_{payload.input_method}",
        "user_confirmed": True,
        "source_supplied_by_user": True,
    }

    with connect(db_path) as conn:
        existed = conn.execute(
            "SELECT id FROM jobs WHERE source_url = ?", (source_url,)
        ).fetchone()
        conn.execute(
            """
            INSERT INTO jobs (
                source, source_url, title, company, city, district,
                salary_text, experience, education, industry, company_size,
                description, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_url) DO UPDATE SET
                title = excluded.title,
                company = excluded.company,
                city = excluded.city,
                district = excluded.district,
                salary_text = excluded.salary_text,
                experience = excluded.experience,
                education = excluded.education,
                industry = excluded.industry,
                company_size = excluded.company_size,
                description = excluded.description,
                raw_json = excluded.raw_json,
                last_seen_at = CURRENT_TIMESTAMP
            """,
            (
                "manual",
                source_url,
                payload.title,
                payload.company,
                city,
                district,
                payload.salary_text,
                payload.experience,
                payload.education,
                payload.industry,
                payload.company_size,
                payload.description,
                json_dump(raw),
            ),
        )
        row = conn.execute(
            "SELECT * FROM jobs WHERE source_url = ?", (source_url,)
        ).fetchone()
        if payload.conversation_id is not None:
            conversation = conn.execute(
                "SELECT id FROM conversations WHERE id = ?", (payload.conversation_id,)
            ).fetchone()
            if conversation is None:
                raise ValueError("对话不存在")
            conn.execute(
                "INSERT OR IGNORE INTO conversation_jobs (conversation_id, job_id) VALUES (?, ?)",
                (payload.conversation_id, row["id"]),
            )

    job = rows_to_dicts([row])[0]
    searchable = "\n".join(
        str(job.get(key) or "")
        for key in ("title", "company", "description", "experience", "education", "industry")
    )
    try:
        index_document("job", job["id"], f"{job['title']} · {job['company']}", searchable, db_path=db_path)
    except Exception:
        pass
    return {"created": existed is None, "job": job}


def extract_screenshot_text(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_SCREENSHOT_SUFFIXES:
        raise ValueError("仅支持 PNG、JPG 和 WEBP 岗位截图")
    if not content:
        raise ValueError("截图文件为空")
    if len(content) > MAX_SCREENSHOT_BYTES:
        raise ValueError("岗位截图不能超过 10MB")

    try:
        from io import BytesIO

        with Image.open(BytesIO(content)) as image:
            image.verify()
    except Exception as exc:
        raise ValueError("无法识别该图片文件") from exc

    try:
        from docling.document_converter import DocumentConverter

        with TemporaryDirectory(prefix="bosscopilot-job-") as directory:
            path = Path(directory) / f"job{suffix}"
            path.write_bytes(content)
            result = DocumentConverter().convert(path)
            text = result.document.export_to_markdown()
    except Exception as exc:
        raise ValueError("本地截图文字识别失败，请改为复制粘贴岗位内容") from exc

    normalized = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if len(normalized) < 10:
        raise ValueError("截图中没有识别到足够文字，请换一张清晰截图或直接粘贴内容")
    return normalized[:30_000]

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .db import connect, row_to_dict, rows_to_dicts
from .interview_workflow import add_job_event


JOB_FIELDS = (
    "job_title",
    "company_name",
    "location",
    "salary_text",
    "source_url",
    "description",
    "notes",
    "status",
    "priority",
)
JOB_STATUSES = {"saved", "applied", "interviewing", "offer", "rejected", "archived"}
JOB_PRIORITIES = {"low", "medium", "high"}
JOB_STATUS_LABELS = {
    "saved": "已保存",
    "applied": "已投递",
    "interviewing": "面试中",
    "offer": "Offer",
    "rejected": "未通过",
    "archived": "已归档",
}

JOB_SELECT = """
    SELECT j.*,
           c.title AS conversation_title,
           COALESCE((
               SELECT COUNT(*) FROM chat_messages m
               WHERE m.conversation_id = j.conversation_id
           ), 0) AS message_count,
           (
               SELECT e.id FROM job_evaluations e
               WHERE e.job_id = j.id
               ORDER BY e.id DESC LIMIT 1
           ) AS latest_evaluation_id,
           (
               SELECT e.created_at FROM job_evaluations e
               WHERE e.job_id = j.id
               ORDER BY e.id DESC LIMIT 1
           ) AS latest_evaluation_at
           ,(
               SELECT e.strategy_id FROM job_evaluations e
               WHERE e.job_id = j.id
               ORDER BY e.id DESC LIMIT 1
           ) AS latest_evaluation_strategy_id
    FROM jobs j
    LEFT JOIN conversations c ON c.id = j.conversation_id
"""


def list_jobs(
    *,
    include_archived: bool = False,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    where = "" if include_archived else "WHERE j.status != 'archived'"
    with connect(db_path) as conn:
        rows = conn.execute(
            f"""
            {JOB_SELECT}
            {where}
            ORDER BY
                CASE j.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                j.updated_at DESC,
                j.id DESC
            """
        ).fetchall()
    return rows_to_dicts(rows)


def get_job(
    job_id: int,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute(f"{JOB_SELECT} WHERE j.id = ?", (job_id,)).fetchone()
    return row_to_dict(row)


def create_job(
    values: dict[str, Any],
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    cleaned = _clean_values(values)
    if not any(
        str(cleaned.get(field) or "").strip()
        for field in ("job_title", "company_name", "description")
    ):
        raise ValueError("请至少填写岗位名称、公司名称或岗位描述")

    with connect(db_path) as conn:
        conversation_id = values.get("conversation_id")
        if conversation_id is not None:
            conversation = conn.execute(
                "SELECT id FROM conversations WHERE id = ?",
                (conversation_id,),
            ).fetchone()
            if conversation is None:
                raise ValueError("关联对话不存在")
        else:
            conversation_title = _project_title(cleaned)
            cursor = conn.execute(
                "INSERT INTO conversations (title) VALUES (?)",
                (conversation_title,),
            )
            conversation_id = cursor.lastrowid
            conn.execute(
                "INSERT INTO conversation_tasks (conversation_id, title) VALUES (?, ?)",
                (conversation_id, "岗位项目"),
            )

        cursor = conn.execute(
            """
            INSERT INTO jobs (
                conversation_id, job_title, company_name, location, salary_text,
                source_url, description, notes, status, priority
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                conversation_id,
                cleaned["job_title"],
                cleaned["company_name"],
                cleaned["location"],
                cleaned["salary_text"],
                cleaned["source_url"],
                cleaned["description"],
                cleaned["notes"],
                cleaned["status"],
                cleaned["priority"],
            ),
        )
        job_id = cursor.lastrowid
    job = get_job(job_id, db_path)
    if job is None:
        raise RuntimeError("岗位项目创建后无法读取")
    add_job_event(
        job_id,
        "project_created",
        "创建岗位项目",
        _project_title(cleaned),
        db_path=db_path,
    )
    return job


def update_job(
    job_id: int,
    values: dict[str, Any],
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    cleaned = _clean_values(values, partial=True)
    previous_status = ""
    with connect(db_path) as conn:
        existing = conn.execute(
            "SELECT * FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if existing is None:
            return None
        previous_status = existing["status"]
        if existing["conversation_id"] is None:
            project_values = {
                "company_name": cleaned.get("company_name", existing["company_name"]),
                "job_title": cleaned.get("job_title", existing["job_title"]),
            }
            cursor = conn.execute(
                "INSERT INTO conversations (title) VALUES (?)",
                (_project_title(project_values),),
            )
            conversation_id = cursor.lastrowid
            conn.execute(
                "INSERT INTO conversation_tasks (conversation_id, title) VALUES (?, ?)",
                (conversation_id, "岗位项目"),
            )
            conn.execute(
                "UPDATE jobs SET conversation_id = ? WHERE id = ?",
                (conversation_id, job_id),
            )
        if cleaned:
            fields = [f"{field} = ?" for field in cleaned]
            parameters = [cleaned[field] for field in cleaned]
            conn.execute(
                f"""
                UPDATE jobs
                SET {", ".join(fields)}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (*parameters, job_id),
            )
    job = get_job(job_id, db_path)
    next_status = cleaned.get("status")
    if next_status and next_status != previous_status:
        add_job_event(
            job_id,
            "status_changed",
            f"状态更新为{JOB_STATUS_LABELS[next_status]}",
            f"{JOB_STATUS_LABELS.get(previous_status, previous_status)} → {JOB_STATUS_LABELS[next_status]}",
            db_path=db_path,
        )
    return job


def delete_job(
    job_id: int,
    db_path: str | Path | None = None,
) -> bool:
    """Delete the project record while preserving its conversation history."""
    with connect(db_path) as conn:
        cursor = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    return cursor.rowcount > 0


def _clean_values(
    values: dict[str, Any],
    *,
    partial: bool = False,
) -> dict[str, str]:
    limits = {
        "job_title": 200,
        "company_name": 200,
        "location": 200,
        "salary_text": 100,
        "source_url": 1_000,
        "description": 50_000,
        "notes": 5_000,
        "status": 30,
        "priority": 20,
    }
    defaults = {
        "job_title": "",
        "company_name": "",
        "location": "",
        "salary_text": "",
        "source_url": "",
        "description": "",
        "notes": "",
        "status": "saved",
        "priority": "medium",
    }
    fields = values.keys() if partial else JOB_FIELDS
    cleaned = {
        field: str(values.get(field, defaults[field]) or "").strip()[: limits[field]]
        for field in fields
        if field in JOB_FIELDS
    }
    if "status" in cleaned and cleaned["status"] not in JOB_STATUSES:
        raise ValueError("岗位状态不合法")
    if "priority" in cleaned and cleaned["priority"] not in JOB_PRIORITIES:
        raise ValueError("岗位优先级不合法")
    source_url = cleaned.get("source_url", "")
    if source_url:
        parsed = urlsplit(source_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("岗位来源必须是有效的 HTTP 或 HTTPS 地址")
    return cleaned


def _project_title(values: dict[str, str]) -> str:
    parts = [
        value
        for value in (values.get("company_name", ""), values.get("job_title", ""))
        if value
    ]
    return " · ".join(parts)[:80] or "新岗位项目"

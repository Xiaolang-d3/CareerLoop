from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from ..db import connect, rows_to_dicts
from ..knowledge import delete_document
from ..workflow.engine import refresh_workflow_status


def list_jobs() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM jobs ORDER BY first_seen_at DESC").fetchall()
    return rows_to_dicts(rows)


def delete_job(job_id: int) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute(
            "SELECT id, title, company FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="岗位不存在或已经删除")
        conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    delete_document("job", job_id)
    return {
        "deleted": True,
        "job": {"id": row["id"], "title": row["title"], "company": row["company"]},
        "workflow": refresh_workflow_status(),
    }


def delete_all_jobs() -> dict[str, Any]:
    with connect() as conn:
        job_ids = [row["id"] for row in conn.execute("SELECT id FROM jobs").fetchall()]
        conn.execute("DELETE FROM jobs")
    for job_id in job_ids:
        delete_document("job", job_id)
    return {
        "deleted_count": len(job_ids),
        "workflow": refresh_workflow_status(),
    }


def list_applications() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT applications.*, jobs.title AS job_title, jobs.company AS company
            FROM applications
            JOIN jobs ON jobs.id = applications.job_id
            ORDER BY applications.created_at DESC
            """
        ).fetchall()
    return rows_to_dicts(rows)

from __future__ import annotations

from pathlib import Path

from ..db import connect, json_dump, rows_to_dicts
from ..domain import Job, JobSummary


class JobRepository:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    @property
    def db_path(self) -> str | Path | None:
        return self._db_path

    def upsert_summaries(self, jobs: list[JobSummary]) -> list[dict]:
        if not jobs:
            return []
        source_urls = [job.source_url for job in jobs]
        with connect(self._db_path) as conn:
            for job in jobs:
                location_parts = job.location.split(maxsplit=1)
                city = location_parts[0] if location_parts else ""
                district = location_parts[1] if len(location_parts) > 1 else ""
                salary = job.salary
                conn.execute(
                    """
                    INSERT INTO jobs (
                        source, source_url, title, company, city, district,
                        salary_text, salary_min, salary_max, raw_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(source_url) DO UPDATE SET
                        source = excluded.source,
                        title = excluded.title,
                        company = excluded.company,
                        city = excluded.city,
                        district = excluded.district,
                        salary_text = excluded.salary_text,
                        salary_min = excluded.salary_min,
                        salary_max = excluded.salary_max,
                        raw_json = excluded.raw_json,
                        last_seen_at = CURRENT_TIMESTAMP
                    """,
                    (
                        job.platform,
                        job.source_url,
                        job.title,
                        job.company,
                        city,
                        district,
                        salary.text if salary else "",
                        salary.minimum if salary else None,
                        salary.maximum if salary else None,
                        json_dump(
                            {
                                "platform": job.platform,
                                "external_id": job.external_id,
                                "tags": job.tags,
                            }
                        ),
                    ),
                )
            placeholders = ",".join("?" for _ in source_urls)
            rows = conn.execute(
                f"SELECT * FROM jobs WHERE source_url IN ({placeholders})",
                source_urls,
            ).fetchall()
        return rows_to_dicts(rows)

    def upsert_detail(self, job: Job) -> dict:
        location_parts = job.location.split(maxsplit=1)
        city = location_parts[0] if location_parts else ""
        district = location_parts[1] if len(location_parts) > 1 else ""
        salary = job.salary
        raw = {**job.raw, "platform": job.platform, "external_id": job.external_id, "tags": job.tags}
        with connect(self._db_path) as conn:
            conn.execute(
                """
                INSERT INTO jobs (
                    source, source_url, title, company, city, district,
                    salary_text, salary_min, salary_max, description, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_url) DO UPDATE SET
                    source = excluded.source,
                    title = excluded.title,
                    company = excluded.company,
                    city = excluded.city,
                    district = excluded.district,
                    salary_text = excluded.salary_text,
                    salary_min = excluded.salary_min,
                    salary_max = excluded.salary_max,
                    description = excluded.description,
                    raw_json = excluded.raw_json,
                    last_seen_at = CURRENT_TIMESTAMP
                """,
                (
                    job.platform,
                    job.source_url,
                    job.title,
                    job.company,
                    city,
                    district,
                    salary.text if salary else "",
                    salary.minimum if salary else None,
                    salary.maximum if salary else None,
                    job.description,
                    json_dump(raw),
                ),
            )
            row = conn.execute(
                "SELECT * FROM jobs WHERE source_url = ?", (job.source_url,)
            ).fetchone()
        stored = rows_to_dicts([row])
        return stored[0]

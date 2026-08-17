from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.db import connect, init_db
from app.profile.candidate_core import create_or_update_profile
from app.profile.career_feedback import record_application_stage
from app.profile.weekly_report import (
    current_week_snapshot,
    ensure_recent_weekly_reports,
    generate_weekly_report,
    list_weekly_reports,
)


class WeeklyReportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "weekly.db"
        init_db(self.db_path)
        create_or_update_profile(name="候选人", db_path=self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _insert_job(self, created_at: str) -> int:
        with connect(self.db_path) as conn:
            cursor = conn.execute(
                "INSERT INTO jobs (job_title, company_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                ("后端工程师", "示例公司", created_at, created_at),
            )
            return int(cursor.lastrowid)

    def _insert_discovered_job(self, first_seen_at: str, company_name: str) -> None:
        with connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO discovered_jobs (
                    external_id, canonical_url, company_name, job_title, content_hash,
                    dedup_key, first_seen_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"ext-{first_seen_at}-{company_name}",
                    f"https://example.com/{company_name}",
                    company_name,
                    "后端工程师",
                    f"hash-{first_seen_at}-{company_name}",
                    f"dedup-{first_seen_at}-{company_name}",
                    first_seen_at,
                    first_seen_at,
                ),
            )

    def test_generate_weekly_report_counts_activity_in_period_only(self) -> None:
        monday = date(2026, 8, 3)  # a Monday
        in_period = monday + timedelta(days=2)
        before_period = monday - timedelta(days=1)

        self._insert_discovered_job(f"{in_period.isoformat()} 09:00:00", "本周公司")
        self._insert_discovered_job(f"{before_period.isoformat()} 09:00:00", "上周公司")

        job_id = self._insert_job(f"{in_period.isoformat()} 10:00:00")
        record_application_stage(
            job_id,
            to_stage="applied",
            occurred_at=f"{in_period.isoformat()} 10:30:00",
            db_path=self.db_path,
        )

        report = generate_weekly_report(monday, monday + timedelta(days=7), db_path=self.db_path)

        self.assertEqual(report["metrics"]["discovered_jobs"], 1)
        self.assertEqual(report["metrics"]["top_companies"][0]["name"], "本周公司")
        self.assertEqual(report["metrics"]["saved_jobs"], 1)
        self.assertEqual(report["metrics"]["applications_submitted"], 1)
        self.assertTrue(any("本周新发现" in line for line in report["highlights"]))

    def test_regenerating_the_same_period_overwrites_rather_than_duplicates(self) -> None:
        monday = date(2026, 8, 3)
        generate_weekly_report(monday, monday + timedelta(days=7), db_path=self.db_path)
        self._insert_discovered_job(f"{monday.isoformat()} 09:00:00", "新公司")
        report = generate_weekly_report(monday, monday + timedelta(days=7), db_path=self.db_path)

        self.assertEqual(report["metrics"]["discovered_jobs"], 1)
        self.assertEqual(len(list_weekly_reports(db_path=self.db_path)), 1)

    def test_ensure_recent_weekly_reports_is_idempotent(self) -> None:
        ensure_recent_weekly_reports(db_path=self.db_path, backfill_weeks=3)
        first = list_weekly_reports(db_path=self.db_path)
        self.assertEqual(len(first), 3)

        ensure_recent_weekly_reports(db_path=self.db_path, backfill_weeks=3)
        second = list_weekly_reports(db_path=self.db_path)
        self.assertEqual(
            [item["generated_at"] for item in first],
            [item["generated_at"] for item in second],
        )

    def test_current_week_snapshot_is_partial_and_not_persisted(self) -> None:
        snapshot = current_week_snapshot(db_path=self.db_path)
        self.assertTrue(snapshot["is_partial"])
        self.assertIsNone(snapshot["generated_at"])
        self.assertEqual(list_weekly_reports(db_path=self.db_path), [])


if __name__ == "__main__":
    unittest.main()

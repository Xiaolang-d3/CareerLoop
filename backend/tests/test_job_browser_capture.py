from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from app.job_browser_capture import (
    BrowserCaptureError,
    canonical_job_url,
    validate_browser_job_capture,
)
from app.db import connect, init_db
from app.opportunities.service import import_browser_job_detail, promote_discovered_job
from pathlib import Path
from tempfile import TemporaryDirectory


def capture_payload(**patch_values):
    payload = {
        "schema_version": "browser-job-capture-v1",
        "capture_id": "capture-1234567890",
        "requested_url": (
            "https://www.zhipin.com/job_detail/abc.html?securityId=temporary"
        ),
        "final_url": "https://www.zhipin.com/job_detail/abc.html",
        "platform": "boss",
        "page_type": "job_detail",
        "title": "AI 智能体应用开发工程师",
        "visible_text": "职位描述\n负责端云智能体系统的架构设计、模型选择、数据处理和系统集成。",
        "hints": {
            "job_title": "AI 智能体应用开发工程师",
            "company_name": "示例科技",
            "location": "上海",
            "salary_text": "15-30K",
            "description": (
                "负责端云智能体系统的架构设计与开发；"
                "负责大模型 Agent 的模型选择、数据处理、决策逻辑和系统集成。"
            ),
        },
        "captured_at": datetime.now(UTC).isoformat(),
        "truncated": False,
    }
    payload.update(patch_values)
    return payload


class BrowserJobCaptureTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "capture.db"
        init_db(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_boss_canonical_url_ignores_security_id(self) -> None:
        left = canonical_job_url(
            "https://www.zhipin.com/job_detail/abc.html?securityId=one"
        )
        right = canonical_job_url(
            "https://www.zhipin.com/job_detail/abc.html?securityId=two"
        )
        self.assertEqual(left, right)
        self.assertEqual(left, "https://www.zhipin.com/job_detail/abc.html")

    def test_valid_capture_builds_scoped_html(self) -> None:
        with patch("app.job_imports.is_public_source_url", return_value=True):
            result = validate_browser_job_capture(capture_payload())

        self.assertEqual(result["platform"], "boss")
        self.assertIn("AI 智能体应用开发工程师", result["html"])
        self.assertIn("示例科技", result["html"])
        self.assertIn("职位描述", result["html"])

    def test_rejects_different_job_page(self) -> None:
        with patch("app.job_imports.is_public_source_url", return_value=True):
            with self.assertRaises(BrowserCaptureError) as raised:
                validate_browser_job_capture(
                    capture_payload(
                        final_url="https://www.zhipin.com/job_detail/other.html"
                    )
                )

        self.assertEqual(raised.exception.code, "page_mismatch")

    def test_rejects_non_boss_page(self) -> None:
        with patch("app.job_imports.is_public_source_url", return_value=True):
            with self.assertRaises(BrowserCaptureError) as raised:
                validate_browser_job_capture(capture_payload(
                    requested_url="https://example.com/jobs/1",
                    final_url="https://example.com/jobs/1",
                ))

        self.assertEqual(raised.exception.code, "platform_unsupported")

    def test_rejects_security_challenge(self) -> None:
        with patch("app.job_imports.is_public_source_url", return_value=True):
            with self.assertRaises(BrowserCaptureError) as raised:
                validate_browser_job_capture(capture_payload(page_type="captcha"))

        self.assertEqual(raised.exception.code, "security_challenge")
        self.assertEqual(raised.exception.page_type, "captcha")

    def test_rejects_expired_capture(self) -> None:
        captured_at = (datetime.now(UTC) - timedelta(minutes=6)).isoformat()
        with patch("app.job_imports.is_public_source_url", return_value=True):
            with self.assertRaises(BrowserCaptureError) as raised:
                validate_browser_job_capture(capture_payload(captured_at=captured_at))

        self.assertEqual(raised.exception.code, "capture_expired")

    def test_detail_import_creates_snapshot_and_reuses_inbox_item(self) -> None:
        with patch("app.job_imports.is_public_source_url", return_value=True):
            first = import_browser_job_detail(
                {**capture_payload(), "user_initiated": True}, db_path=self.db_path
            )
            second = import_browser_job_detail(
                {**capture_payload(), "user_initiated": True}, db_path=self.db_path
            )
        self.assertEqual(first["import_outcome"], "created")
        self.assertEqual(second["job"]["id"], first["job"]["id"])
        with connect(self.db_path) as conn:
            snapshots = conn.execute("SELECT COUNT(*) count FROM job_capture_snapshots").fetchone()
        self.assertEqual(snapshots["count"], 2)

    def test_refresh_updates_promoted_project_and_timeline(self) -> None:
        with patch("app.job_imports.is_public_source_url", return_value=True):
            imported = import_browser_job_detail(
                {**capture_payload(), "user_initiated": True}, db_path=self.db_path
            )
            project = promote_discovered_job(imported["job"]["id"], db_path=self.db_path)
            refreshed = import_browser_job_detail(
                {**capture_payload(hints={
                    **capture_payload()["hints"], "salary_text": "20-35K"
                }), "user_initiated": True}, db_path=self.db_path
            )
        self.assertEqual(refreshed["job"]["id"], imported["job"]["id"])
        with connect(self.db_path) as conn:
            stored = conn.execute("SELECT salary_text FROM jobs WHERE id = ?", (project["id"],)).fetchone()
            event = conn.execute("SELECT title FROM job_events WHERE job_id = ? ORDER BY id DESC", (project["id"],)).fetchone()
        self.assertEqual(stored["salary_text"], "20-35K")
        self.assertEqual(event["title"], "已从浏览器刷新岗位信息")


if __name__ == "__main__":
    unittest.main()

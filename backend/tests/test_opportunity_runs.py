from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.profile.candidate_core import create_or_update_profile, create_strategy, propose_fact
from app.db import init_db
from app.opportunities.service import add_opportunity_source, detect_provider, import_visible_jobs, list_discovered_jobs
from app.opportunities.runs import create_discovery_run, execute_discovery_run, get_discovery_run


class OpportunityRunsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "opportunities.db"
        init_db(self.db_path)
        create_or_update_profile(name="候选人", db_path=self.db_path)
        self.strategy = create_strategy(
            name="Agent 工程师",
            target_roles=["Agent 工程师"],
            blocked_keywords=["外包"],
            is_active=True,
            db_path=self.db_path,
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_domestic_ats_detection_uses_public_page_adapters(self) -> None:
        self.assertEqual(detect_provider("https://jobs.mokahr.com/example")[0], "moka")
        self.assertEqual(detect_provider("https://example.italent.cn/career")[0], "beisen")
        self.assertEqual(detect_provider("https://career.dayee.com/example")[0], "dayee")

    def test_domestic_platform_scan_waits_for_user_visible_page(self) -> None:
        source = add_opportunity_source(
            source_url="https://www.zhipin.com/web/geek/job",
            access_mode="browser_visible_only",
            platform="boss",
            db_path=self.db_path,
        )
        run = create_discovery_run(
            "scan", config={"source_ids": [source["id"]]}, db_path=self.db_path
        )
        result = execute_discovery_run(run["id"], db_path=self.db_path)
        self.assertEqual(result["status"], "waiting_for_user")
        self.assertEqual(result["items"][0]["stage"], "open_visible_page")
        self.assertEqual(result["items"][0]["status"], "waiting_for_user")

    def test_pipeline_scores_confirmed_facts_without_changing_user_decision(self) -> None:
        confirmed = propose_fact(
            category="skill", statement="熟悉 Python 和 FastAPI", db_path=self.db_path
        )
        propose_fact(
            category="skill", statement="熟悉 Kubernetes", db_path=self.db_path
        )
        import_visible_jobs(
            platform="boss",
            page_url="https://www.zhipin.com/web/geek/job",
            captured_at="2026-08-01T10:00:00Z",
            user_initiated=True,
            jobs=[{
                "external_id": "job-1",
                "url": "https://www.zhipin.com/job_detail/job-1.html",
                "company_name": "示例科技",
                "job_title": "Python Agent 工程师",
                "location": "上海",
                "description": "负责 Python、FastAPI 和 Kubernetes 平台开发",
            }],
            db_path=self.db_path,
        )
        job = list_discovered_jobs(db_path=self.db_path)[0]
        run = create_discovery_run(
            "pipeline",
            strategy_id=self.strategy["id"],
            config={"job_ids": [job["id"]], "deep_analysis": "none"},
            db_path=self.db_path,
        )
        result = execute_discovery_run(run["id"], db_path=self.db_path)
        refreshed = list_discovered_jobs(db_path=self.db_path)[0]
        self.assertEqual(result["status"], "completed")
        self.assertEqual(refreshed["lifecycle_status"], "discovered")
        self.assertEqual(refreshed["processing_status"], "evaluated")
        self.assertIn("Kubernetes", refreshed["assessment"]["evidence_gaps"])
        self.assertNotIn("Kubernetes", refreshed["assessment"]["matched_skills"])

    def test_visible_import_rejects_cards_without_job_titles(self) -> None:
        with self.assertRaisesRegex(ValueError, "没有可导入的有效岗位"):
            import_visible_jobs(
                platform="boss",
                page_url="https://www.zhipin.com/web/geek/job",
                captured_at="2026-08-01T10:00:00Z",
                user_initiated=True,
                jobs=[{"company_name": "示例科技", "description": "缺少岗位名称"}],
                db_path=self.db_path,
            )
        self.assertEqual(list_discovered_jobs(db_path=self.db_path), [])

    def test_run_history_is_persisted_with_progress(self) -> None:
        run = create_discovery_run("scan", config={"source_ids": []}, db_path=self.db_path)
        execute_discovery_run(run["id"], db_path=self.db_path)
        stored = get_discovery_run(run["id"], db_path=self.db_path)
        self.assertEqual(stored["status"], "completed")
        self.assertEqual(stored["total_count"], 0)


if __name__ == "__main__":
    unittest.main()

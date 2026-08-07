from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.db import init_db
from app.jobs import create_job, delete_job, get_job, list_jobs, update_job


class JobProjectTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "jobs.db"
        init_db(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_job_project_roundtrip_creates_dedicated_conversation(self) -> None:
        created = create_job(
            {
                "job_title": "AI 产品经理",
                "company_name": "示例科技",
                "location": "上海",
                "salary_text": "30-45K",
                "description": "负责企业级 Agent 产品规划与落地。",
                "priority": "high",
            },
            self.db_path,
        )

        self.assertEqual(created["job_title"], "AI 产品经理")
        self.assertEqual(created["company_name"], "示例科技")
        self.assertEqual(created["conversation_title"], "示例科技 · AI 产品经理")
        self.assertIsInstance(created["conversation_id"], int)
        self.assertEqual(list_jobs(db_path=self.db_path)[0]["id"], created["id"])

        updated = update_job(
            created["id"],
            {"status": "applied", "notes": "已通过官网投递"},
            self.db_path,
        )
        self.assertEqual(updated["status"], "applied")
        self.assertEqual(updated["notes"], "已通过官网投递")

        self.assertTrue(delete_job(created["id"], self.db_path))
        self.assertIsNone(get_job(created["id"], self.db_path))

    def test_archived_projects_are_hidden_by_default(self) -> None:
        created = create_job(
            {"job_title": "Agent 工程师", "status": "archived"},
            self.db_path,
        )

        self.assertEqual(list_jobs(db_path=self.db_path), [])
        archived = list_jobs(include_archived=True, db_path=self.db_path)
        self.assertEqual([item["id"] for item in archived], [created["id"]])

    def test_empty_project_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "至少填写"):
            create_job({}, self.db_path)

    def test_unsafe_source_url_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "HTTP"):
            create_job(
                {"job_title": "测试岗位", "source_url": "javascript:alert(1)"},
                self.db_path,
            )


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.db import connect, init_db, json_dump
from app.knowledge import index_document
from app.tools import (
    AnalyzeResumeAgainstJdTool,
    SearchResumeEvidenceTool,
    ToolContext,
)


class MinimalAgentToolTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self._temp_dir.name) / "test.db"
        init_db(self.db_path)
        with connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO profiles (
                    name, resume_text, resume_redacted_text, privacy_mode,
                    skills_json, projects_json
                ) VALUES (?, ?, ?, 'redacted', ?, ?)
                """,
                (
                    "测试候选人",
                    "5 年 Python 后端和 Agent 平台经验，手机号 13800138000",
                    "5 年 Python 后端和 Agent 平台经验，手机号 [手机号已隐藏]",
                    json_dump(["Python", "FastAPI", "Agent"]),
                    json_dump([{"name": "智能体平台", "summary": "构建工具调用运行时"}]),
                ),
            )
            self.profile_id = cursor.lastrowid
        index_document(
            "resume",
            self.profile_id,
            "测试候选人脱敏简历",
            "5 年 Python 后端经验。负责设计 Agent 工具调用运行时和 FastAPI 服务。",
            {"privacy_mode": "redacted"},
            self.db_path,
        )
        index_document(
            "job",
            99,
            "不应被检索的岗位",
            "负责 Kubernetes 集群维护",
            {},
            self.db_path,
        )
        self.context = ToolContext(platform_name="manual")

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    async def test_analysis_uses_user_jd_without_implicitly_writing_a_job(self) -> None:
        result = await AnalyzeResumeAgainstJdTool(self.db_path).execute(
            {
                "job_title": "AI Agent 工程师",
                "company": "示例科技",
                "job_description": "负责 Python Agent 平台和 FastAPI 服务开发，需要 Docker 使用经验。",
            },
            self.context,
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.data["job_context"]["source"], "conversation_job_description")
        self.assertEqual(result.data["persistence"], "not_saved_as_job")
        self.assertIn("Python", result.data["analysis"]["matched_skills"])
        self.assertIn("Docker", result.data["analysis"]["missing_skills"])
        self.assertNotIn("13800138000", json_dump(result.data))
        with connect(self.db_path) as conn:
            job_count = conn.execute(
                "SELECT COUNT(*) AS count FROM jobs"
            ).fetchone()["count"]
            legacy_match_tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'match_results'"
            ).fetchall()
            self.assertEqual(job_count, 0)
            self.assertEqual(legacy_match_tables, [])

    async def test_analysis_requires_a_current_resume(self) -> None:
        empty_db = Path(self._temp_dir.name) / "empty.db"
        init_db(empty_db)

        result = await AnalyzeResumeAgainstJdTool(empty_db).execute(
            {"job_description": "负责 Python Agent 平台开发并维护 FastAPI 服务。"},
            self.context,
        )

        self.assertFalse(result.ok)
        self.assertEqual(result.error.code, "candidate_profile_missing")

    async def test_resume_evidence_search_never_returns_job_documents(self) -> None:
        result = await SearchResumeEvidenceTool(self.db_path).execute(
            {"query": "Agent 工具调用", "limit": 5},
            self.context,
        )

        self.assertTrue(result.ok)
        self.assertGreaterEqual(len(result.data["evidence"]), 1)
        self.assertEqual(
            {item["source_type"] for item in result.data["evidence"]},
            {"resume"},
        )

    async def test_analysis_rejects_missing_or_too_short_jd(self) -> None:
        result = await AnalyzeResumeAgainstJdTool(self.db_path).execute(
            {"job_description": "Python"},
            self.context,
        )

        self.assertFalse(result.ok)
        self.assertEqual(result.error.code, "invalid_arguments")


if __name__ == "__main__":
    unittest.main()

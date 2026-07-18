from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.db import connect, init_db, json_dump
from app.domain import Job, JobSummary, SalaryRange
from app.repositories import JobRepository
from app.tools import (
    AnalyzeJobTool,
    AnalyzeResumeGapTool,
    GetCandidateContextTool,
    QueueApplicationTool,
    RankJobsTool,
    RequestManualJobImportTool,
    SaveGreetingDraftTool,
    ToolContext,
    UpdateApplicationStatusTool,
    UpdateJobStatusTool,
)


class LocalToolFlowTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self._temp_dir.name) / "test.db"
        init_db(self.db_path)
        with connect(self.db_path) as conn:
            profile_cursor = conn.execute(
                """
                INSERT INTO profiles (name, resume_text, skills_json, projects_json)
                VALUES (?, ?, ?, ?)
                """,
                (
                    "测试候选人",
                    "5 年 Python 后端和 Agent 平台经验",
                    json_dump(["Python", "FastAPI", "Agent"]),
                    json_dump([{"name": "智能体平台", "summary": "构建工具调用运行时"}]),
                ),
            )
            self.profile_id = profile_cursor.lastrowid
            conn.execute(
                """
                INSERT INTO preferences (
                    profile_id, target_roles_json, target_cities_json,
                    salary_min, blocked_keywords_json, blocked_companies_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    self.profile_id,
                    json_dump(["Agent 工程师"]),
                    json_dump(["上海"]),
                    25000,
                    json_dump(["培训"]),
                    json_dump(["屏蔽公司"]),
                ),
            )
        repository = JobRepository(self.db_path)
        stored = repository.upsert_detail(
            Job(
                platform="manual",
                external_id="abc123",
                source_url="https://www.zhipin.com/job_detail/abc123.html",
                title="AI Agent 工程师",
                company="示例科技",
                location="上海 浦东新区",
                salary=SalaryRange(minimum=25000, maximum=40000, text="25-40K"),
                tags=["Python", "FastAPI", "3-5年"],
                description="负责 Python Agent 平台和 FastAPI 服务开发",
                requirements=["Python", "FastAPI"],
                raw={"recruiter": "技术负责人"},
            )
        )
        self.job_id = stored["id"]
        self.context = ToolContext(platform_name="manual")

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    async def test_candidate_analysis_and_local_application_flow(self) -> None:
        candidate = await GetCandidateContextTool(self.db_path).execute({}, self.context)
        self.assertTrue(candidate.ok)
        self.assertEqual(candidate.data["profile"]["id"], self.profile_id)
        self.assertEqual(candidate.data["preferences"]["salary_min"], 25000)

        analysis = await AnalyzeJobTool(self.db_path).execute(
            {"local_id": self.job_id, "profile_id": self.profile_id}, self.context
        )
        self.assertTrue(analysis.ok)
        self.assertGreaterEqual(analysis.data["match"]["score"], 75)
        self.assertEqual(analysis.data["match"]["level"], "recommended")

        shortlist = await UpdateJobStatusTool(self.db_path).execute(
            {"local_id": self.job_id, "status": "shortlisted"}, self.context
        )
        self.assertEqual(shortlist.data["job"]["status"], "shortlisted")

        draft = await SaveGreetingDraftTool(self.db_path).execute(
            {
                "local_id": self.job_id,
                "profile_id": self.profile_id,
                "style": "technical",
                "text": "您好，我有 Python Agent 平台开发经验，想进一步了解这个岗位。",
            },
            self.context,
        )
        self.assertTrue(draft.ok)
        self.assertIn("尚未发送", draft.message)

        queued = await QueueApplicationTool(self.db_path).execute(
            {"local_id": self.job_id, "profile_id": self.profile_id}, self.context
        )
        self.assertTrue(queued.ok)
        self.assertEqual(queued.data["application"]["status"], "queued")
        self.assertIn("尚未执行外部操作", queued.message)

        duplicate = await QueueApplicationTool(self.db_path).execute(
            {"local_id": self.job_id, "profile_id": self.profile_id}, self.context
        )
        self.assertEqual(
            duplicate.data["application"]["id"], queued.data["application"]["id"]
        )

        progressed = await UpdateApplicationStatusTool(self.db_path).execute(
            {
                "application_id": queued.data["application"]["id"],
                "status": "contacted",
                "notes": "用户确认已经在 BOSS 开聊",
            },
            self.context,
        )
        self.assertEqual(progressed.data["application"]["status"], "contacted")
        self.assertIsNotNone(progressed.data["application"]["last_contact_at"])

    async def test_rank_uses_salary_and_block_lists(self) -> None:
        normal = JobSummary(
            platform="manual",
            external_id="normal",
            source_url="https://example.com/normal",
            title="Agent 工程师",
            company="正常公司",
            location="上海",
            salary=SalaryRange(minimum=25000, maximum=35000, text="25-35K"),
            tags=["Python"],
        )
        blocked = JobSummary(
            platform="manual",
            external_id="blocked",
            source_url="https://example.com/blocked",
            title="Agent 培训工程师",
            company="屏蔽公司",
            location="上海",
            salary=SalaryRange(minimum=10000, maximum=15000, text="10-15K"),
            tags=["Python"],
        )
        result = await RankJobsTool().execute(
            {
                "platform": "manual",
                "jobs": [blocked.model_dump(), normal.model_dump()],
                "keywords": ["Agent", "Python"],
                "cities": ["上海"],
                "salary_minimum": 25000,
                "blocked_keywords": ["培训"],
                "blocked_companies": ["屏蔽公司"],
            },
            self.context,
        )
        matches = result.data["matches"]
        self.assertEqual(matches[0]["job"]["external_id"], "normal")
        blocked_match = matches[-1]
        self.assertIn("命中屏蔽公司：屏蔽公司", blocked_match["risks"])
        self.assertIn("薪资上限低于期望下限", blocked_match["risks"])

    async def test_agent_can_request_manual_job_import(self) -> None:
        result = await RequestManualJobImportTool().execute(
            {"reason": "导入用户主动提供的岗位并分析"},
            self.context,
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.status, "waiting_approval")
        self.assertEqual(result.error.code, "manual_job_import_required")
        self.assertIn("粘贴岗位内容", result.message)

    async def test_resume_gap_uses_redacted_profile_evidence(self) -> None:
        with connect(self.db_path) as conn:
            conn.execute(
                """
                UPDATE profiles
                SET resume_text = ?, resume_redacted_text = ?, privacy_mode = 'redacted'
                WHERE id = ?
                """,
                (
                    "Python 工程师，手机号 13800138000，邮箱 user@example.com",
                    "Python 工程师，手机号 [手机号已隐藏]，邮箱 [邮箱已隐藏]",
                    self.profile_id,
                ),
            )

        result = await AnalyzeResumeGapTool(self.db_path).execute(
            {"local_id": self.job_id, "profile_id": self.profile_id},
            self.context,
        )

        self.assertTrue(result.ok)
        serialized = json_dump(result.data["gap"])
        self.assertNotIn("13800138000", serialized)
        self.assertNotIn("user@example.com", serialized)
        self.assertIn("[手机号已隐藏]", serialized)


if __name__ == "__main__":
    unittest.main()

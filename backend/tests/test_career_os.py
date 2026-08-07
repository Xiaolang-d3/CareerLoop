from __future__ import annotations

import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import db as db_module
from app.main import app

from app.candidate_core import (
    RESUME_SOURCE_ID,
    create_candidate_source,
    create_or_update_profile,
    create_strategy,
    get_candidate_context,
    ingest_resume_knowledge,
    list_facts,
    propose_fact,
    remove_fact,
    verify_candidate_material,
)
from app.agent.orchestration import TOOL_POLICIES, route_task
from app.career_feedback import career_patterns, record_application_stage
from app.db import connect, init_db
from app.tools import (
    PauseProfileInterviewTool,
    RecordProfileInterviewAnswerTool,
    SearchCandidateEvidenceTool,
    StartProfileInterviewTool,
    ToolContext,
)
from app.jobs import create_job
from app.opportunities import (
    add_opportunity_source,
    create_or_update_company,
    list_discovered_jobs,
    promote_discovered_job,
    scan_opportunity_source,
)


class CareerOperatingSystemTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "career-os.db"
        init_db(self.db_path)
        self.profile = create_or_update_profile(name="测试候选人", db_path=self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_resume_ingest_writes_facts_into_the_profile_document(self) -> None:
        create_candidate_source(
            source_type="resume",
            title="脱敏简历",
            content="负责 Python 服务，接口性能提升 30%。",
            db_path=self.db_path,
        )
        proposals = ingest_resume_knowledge(
            source_id=RESUME_SOURCE_ID, db_path=self.db_path
        )
        metric = next(item for item in proposals if item["category"] == "achievement")
        self.assertTrue(metric["evidence"])

        context = get_candidate_context("resume", db_path=self.db_path)
        self.assertIn(metric["id"], [item["id"] for item in context["confirmed_facts"]])

    def test_fact_gate_blocks_metric_absent_from_the_document(self) -> None:
        propose_fact(
            category="achievement", statement="将转化率提升 30%", db_path=self.db_path
        )
        self.assertTrue(
            verify_candidate_material("将转化率提升 30%", db_path=self.db_path)["can_finalize"]
        )
        blocked = verify_candidate_material("将转化率提升 80%", db_path=self.db_path)
        self.assertFalse(blocked["can_finalize"])
        self.assertEqual(blocked["issues"][0]["sentence"], "将转化率提升 80%")

    def test_removing_a_line_drops_it_from_the_document(self) -> None:
        fact = propose_fact(
            category="skill", statement="具备 Python 经验", db_path=self.db_path
        )
        propose_fact(category="skill", statement="具备 Go 经验", db_path=self.db_path)
        self.assertTrue(remove_fact(fact["id"], self.db_path))
        remaining = [item["statement"] for item in list_facts(db_path=self.db_path)]
        self.assertEqual(remaining, ["具备 Go 经验"])
        self.assertFalse(remove_fact(fact["id"], self.db_path))

    def test_multiple_strategies_share_confirmed_facts_but_keep_separate_targets(self) -> None:
        fact = propose_fact(category="skill", statement="具备 Python 工程经验", db_path=self.db_path)
        review_fact(fact["id"], status="confirmed", db_path=self.db_path)
        product = create_strategy(
            name="AI 产品经理", target_roles=["AI 产品经理"], is_active=True,
            db_path=self.db_path,
        )
        engineer = create_strategy(
            name="Agent 工程师", target_roles=["Agent 工程师"], is_active=False,
            db_path=self.db_path,
        )

        product_context = get_candidate_context("match", strategy_id=product["id"], db_path=self.db_path)
        engineer_context = get_candidate_context("match", strategy_id=engineer["id"], db_path=self.db_path)
        self.assertEqual(product_context["confirmed_facts"], engineer_context["confirmed_facts"])
        self.assertNotEqual(product_context["strategy"]["target_roles"], engineer_context["strategy"]["target_roles"])

    def test_patterns_wait_for_five_progressed_jobs(self) -> None:
        for index in range(5):
            job = create_job(
                {"job_title": f"岗位 {index}", "company_name": "示例公司", "description": "这是一个足够长的岗位描述用于测试事件。"},
                self.db_path,
            )
            if index < 4:
                record_application_stage(job["id"], to_stage="applied", db_path=self.db_path)
        self.assertFalse(career_patterns(self.db_path)["eligible"])
        record_application_stage(job["id"], to_stage="applied", db_path=self.db_path)
        report = career_patterns(self.db_path)
        self.assertTrue(report["eligible"])
        self.assertIn("不代表市场因果", report["limitations"][0])

    def test_official_source_scan_deduplicates_and_requires_promotion(self) -> None:
        company = create_or_update_company(name="Example", followed=True, db_path=self.db_path)
        with patch("app.opportunities.is_public_source_url", return_value=True):
            source = add_opportunity_source(
                company_id=company["id"],
                source_url="https://boards.greenhouse.io/example",
                db_path=self.db_path,
            )
        fixture = [{
            "external_id": "job-1", "canonical_url": "https://example.com/jobs/1",
            "company_name": "Example", "job_title": "AI Engineer",
            "location": "上海", "salary_text": "", "description": "负责 AI Agent 平台开发。",
        }]
        with patch("app.opportunities._provider_jobs", return_value=fixture):
            first = scan_opportunity_source(source["id"], db_path=self.db_path)
            second = scan_opportunity_source(source["id"], db_path=self.db_path)
        self.assertEqual(first["created"], 1)
        self.assertEqual(second["created"], 0)
        discovered = list_discovered_jobs(db_path=self.db_path)
        self.assertEqual(len(discovered), 1)
        with patch("app.opportunities._provider_jobs", return_value=[]):
            closed = scan_opportunity_source(source["id"], db_path=self.db_path)
        self.assertEqual(closed["closed"], 1)
        with patch("app.opportunities._provider_jobs", return_value=fixture):
            restored = scan_opportunity_source(source["id"], db_path=self.db_path)
        self.assertEqual(restored["restored"], 1)
        with connect(self.db_path) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) count FROM jobs").fetchone()["count"], 0)
        promoted = promote_discovered_job(discovered[0]["id"], db_path=self.db_path)
        self.assertEqual(promoted["job_title"], "AI Engineer")


class CareerOperatingSystemApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.original_db_path = db_module.DB_PATH
        db_module.DB_PATH = Path(self.temp_dir.name) / "career-api.db"
        init_db()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        db_module.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_empty_database_to_confirmed_context_and_outcome_feedback(self) -> None:
        self.assertIsNone(self.client.get("/career-profile").json()["profile"])
        created = self.client.put(
            "/career-profile",
            json={"name": "接口用户", "locale": "zh-CN", "privacy_mode": "redacted"},
        )
        self.assertEqual(created.status_code, 200)
        source = self.client.post(
            "/career-profile/sources",
            json={
                "source_type": "resume", "title": "cv.md",
                "content": "使用 Python 和 FastAPI 构建服务，性能提升 30%。",
                "privacy_mode": "redacted", "allow_model_original": False,
                "extract_knowledge": True,
            },
        )
        self.assertEqual(source.status_code, 200)
        source_payload = source.json()["source"]
        self.assertNotIn("content_text", source_payload)
        revision_before_access = self.client.get("/career-profile").json()["profile"]["knowledge_revision"]
        access = self.client.patch(
            f"/career-profile/sources/{source_payload['id']}/access",
            json={"allow_model_original": True, "privacy_mode": "original"},
        )
        self.assertEqual(access.status_code, 200)
        self.assertTrue(access.json()["allow_model_original"])
        self.assertGreater(
            self.client.get("/career-profile").json()["profile"]["knowledge_revision"],
            revision_before_access,
        )
        pending = self.client.get("/career-profile/facts?status=pending").json()
        self.assertTrue(pending)
        formal_before = self.client.get("/career-profile/context?scope=resume").json()
        self.assertEqual(formal_before["confirmed_facts"], [])

        fact_id = pending[0]["id"]
        reviewed = self.client.post(
            f"/career-profile/facts/{fact_id}/review", json={"action": "confirm"}
        )
        self.assertEqual(reviewed.status_code, 200)
        formal_after = self.client.get("/career-profile/context?scope=resume").json()
        self.assertEqual(formal_after["confirmed_facts"][0]["id"], fact_id)

        strategy = self.client.post(
            "/career-profile/strategies",
            json={"name": "后端工程", "target_roles": ["Python 工程师"], "is_active": True},
        ).json()
        job = self.client.post(
            "/jobs",
            json={"job_title": "Python 工程师", "company_name": "示例科技", "description": "负责 Python FastAPI 服务设计开发和稳定性建设。"},
        ).json()
        outcome = self.client.post(
            f"/jobs/{job['id']}/outcomes",
            json={"stage": "applied", "notes": "官网投递", "recruiter_feedback": ""},
        )
        self.assertEqual(outcome.status_code, 200)
        debrief = self.client.post(
            f"/interviews/{job['id']}/debrief",
            json={
                "strategy_id": strategy["id"],
                "source_text": "面试讨论了接口性能。",
                "questions": [{"question": "如何优化接口？", "answer": "先定位瓶颈", "competency": "性能优化"}],
                "raw_feedback": "思路清晰",
            },
        )
        self.assertEqual(debrief.status_code, 200)
        exported = self.client.get("/career-profile/export?format=bundle")
        self.assertEqual(exported.status_code, 200)
        self.assertEqual(exported.json()["json"]["schema_version"], "bosscopilot-career-profile-v2")

    def test_profile_interview_tools_drive_resumable_one_question_flow(self) -> None:
        """The interview is model-callable now, so drive the tools, not chat text."""
        conversation = self.client.post("/conversations", json={"title": "画像访谈"}).json()
        context = ToolContext(
            platform_name="manual",
            conversation_id=conversation["id"],
            user_content="开始了解我",
        )

        async def scenario() -> None:
            started = await StartProfileInterviewTool().execute({}, context)
            self.assertEqual(started.status, "done")
            self.assertIn("最想争取的具体岗位", started.data["next_question"])

            answered = await RecordProfileInterviewAnswerTool().execute(
                {"answer": "AI 产品经理，上海，期望 35K"}, context
            )
            self.assertEqual(answered.status, "done")
            self.assertEqual(answered.data["knowledge_proposal"]["status"], "pending")
            self.assertIn("核心职责", answered.data["next_question"])

            paused = await PauseProfileInterviewTool().execute({}, context)
            self.assertEqual(paused.data["profile_interview"]["status"], "paused")

            resumed = await StartProfileInterviewTool().execute({}, context)
            self.assertEqual(resumed.data["profile_interview"]["status"], "active")
            self.assertIn("核心职责", resumed.data["next_question"])

        asyncio.run(scenario())
        profile = self.client.get("/career-profile").json()
        self.assertEqual(len([fact for fact in profile["facts"] if fact["status"] == "pending"]), 1)

    def test_profile_interview_route_admits_tools_without_exact_phrase(self) -> None:
        """Keywords only admit the lane; an active session keeps it open regardless."""
        available = set(TOOL_POLICIES)
        onboarding = route_task("开始了解我", available)
        self.assertEqual(onboarding.kind, "profile_onboarding")
        self.assertIn("start_profile_interview", onboarding.allowed_tools)

        mid_answer = route_task("AI 产品经理，上海", available, profile_interview_active=True)
        self.assertIn("record_profile_interview_answer", mid_answer.allowed_tools)

        unrelated = route_task("AI 产品经理，上海", available)
        self.assertEqual(unrelated.allowed_tools, ())

    def test_missing_profile_is_not_reported_as_invalid_arguments(self) -> None:
        context = ToolContext(platform_name="manual", user_content="我的经历有哪些")

        async def scenario() -> None:
            missing = await SearchCandidateEvidenceTool().execute({"query": "我的经历"}, context)
            self.assertEqual(missing.error.code, "profile_required")
            self.assertTrue(missing.error.retryable)
            self.assertIn("开始画像访谈", missing.error.message)

            bad_arguments = await SearchCandidateEvidenceTool().execute({"query": ""}, context)
            self.assertEqual(bad_arguments.error.code, "invalid_arguments")

        asyncio.run(scenario())
        # Read-only tools must not create rows as a side effect.
        self.assertIsNone(self.client.get("/career-profile").json()["profile"])

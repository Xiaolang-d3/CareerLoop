from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.jobs.evaluations import create_job_evaluation
from app.jobs.service import create_job
from app.profile import document as profile_document
from app.profile.candidate_core import (
    RESUME_SOURCE_ID,
    blocked_claim_texts,
    blocked_skill_names,
    create_candidate_source,
    create_or_update_profile,
    create_strategy,
    get_candidate_context,
    get_career_profile,
    ingest_resume_knowledge,
    list_review_inbox,
    propose_fact,
    resolved_skill_names,
    review_fact,
    verify_candidate_material,
)
from app.profile.intelligence import extract_skill_tags, extract_skills
from app.db import init_db
from app.jobs.quick_match import analyze_job_description


RESUME_WITH_NOVEL_TAG = """
专业技能
Python、Redis、FastAPI
擅长实时语音链路、分布式服务架构。
负责支付网关，接口性能提升 30%。
"""


class InboxReviewTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "inbox-review.db"
        init_db(self.db_path)
        create_or_update_profile(name="测试候选人", db_path=self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _ingest(self, text: str = RESUME_WITH_NOVEL_TAG) -> list[dict]:
        create_candidate_source(
            source_type="resume",
            title="脱敏简历",
            content=text,
            db_path=self.db_path,
        )
        return ingest_resume_knowledge(source_id=RESUME_SOURCE_ID, db_path=self.db_path)

    def test_ingest_proposes_short_novel_tags_and_achievements_not_resume_duplicates(self) -> None:
        proposals = self._ingest()
        statements = [item["statement"] for item in proposals]
        categories = {item["category"] for item in proposals}

        self.assertTrue(any(item["category"] == "achievement" for item in proposals))
        self.assertIn("实时语音链路", statements)
        self.assertNotIn("Python", statements)
        self.assertNotIn("Redis", statements)
        self.assertFalse(any("具备" in item["statement"] for item in proposals))
        self.assertFalse(any("擅长" in item["statement"] for item in proposals))
        skill = next(item for item in proposals if item["statement"] == "实时语音链路")
        self.assertEqual(skill["value"]["name"], "实时语音链路")
        self.assertEqual(skill["canonical_key"], "skill:实时语音链路")
        self.assertIn("achievement", categories)

        inbox = list_review_inbox(db_path=self.db_path)
        inbox_statements = [item["statement"] for item in inbox]
        self.assertIn("实时语音链路", inbox_statements)
        self.assertNotIn("Python", inbox_statements)
        self.assertTrue(any(item["category"] == "achievement" for item in inbox))

    def test_confirm_skill_writes_short_tag_to_document_and_downstream_can_read_it(self) -> None:
        proposals = self._ingest()
        skill = next(item for item in proposals if item["statement"] == "实时语音链路")
        review_fact(skill["id"], status="confirmed", db_path=self.db_path)

        document = profile_document.load(self.db_path)
        assert document is not None
        self.assertIn("实时语音链路", document.entries("skills"))
        self.assertIn("实时语音链路", resolved_skill_names(db_path=self.db_path))

        context = get_candidate_context("match", db_path=self.db_path)
        statements = [item["statement"] for item in context["confirmed_facts"]]
        self.assertTrue(any("实时语音链路" in item for item in statements))

        analysis = analyze_job_description(db_path=self.db_path)
        self.assertIn("实时语音链路", analysis["analysis"]["resume"]["skills"])

    def test_confirm_achievement_writes_to_document_results(self) -> None:
        proposals = self._ingest()
        metric = next(item for item in proposals if item["category"] == "achievement")
        review_fact(metric["id"], status="confirmed", db_path=self.db_path)

        document = profile_document.load(self.db_path)
        assert document is not None
        self.assertTrue(any("30%" in line for line in document.entries("achievements")))

    def test_reject_blocks_skill_even_when_resume_still_mentions_it(self) -> None:
        fact = propose_fact(
            category="skill",
            statement="Redis",
            canonical_key="skill:redis",
            value={"name": "Redis"},
            db_path=self.db_path,
        )
        review_fact(fact["id"], status="disputed", db_path=self.db_path)
        create_candidate_source(
            source_type="resume",
            title="脱敏简历",
            content="专业技能\nPython、Redis、Docker",
            db_path=self.db_path,
        )

        self.assertIn("Redis", blocked_skill_names(db_path=self.db_path))
        self.assertTrue(any("Redis" in item for item in blocked_claim_texts(db_path=self.db_path)))
        self.assertNotIn("Redis", extract_skills("专业技能 Python Redis Docker", blocked=blocked_skill_names(self.db_path)))
        self.assertNotIn("Redis", extract_skill_tags("专业技能\nPython、Redis", blocked=blocked_skill_names(self.db_path)))
        self.assertNotIn("Redis", resolved_skill_names(db_path=self.db_path))

        analysis = analyze_job_description(db_path=self.db_path)
        self.assertNotIn("Redis", analysis["analysis"]["resume"]["skills"])
        self.assertIn("Python", analysis["analysis"]["resume"]["skills"])

        again = ingest_resume_knowledge(source_id=RESUME_SOURCE_ID, db_path=self.db_path)
        self.assertFalse(any(item.get("value", {}).get("name") == "Redis" for item in again))
        self.assertFalse(any(item["statement"] == "Redis" and item["status"] == "pending" for item in list_review_inbox(db_path=self.db_path)))

    def test_rejected_claim_blocks_material_verification(self) -> None:
        fact = propose_fact(
            category="achievement",
            statement="将转化率提升 80%",
            canonical_key="achievement:将转化率提升 80%",
            db_path=self.db_path,
        )
        review_fact(fact["id"], status="disputed", db_path=self.db_path)
        blocked = verify_candidate_material("对外材料：将转化率提升 80%", db_path=self.db_path)
        self.assertFalse(blocked["can_finalize"])
        self.assertTrue(blocked["retracted_claims"])

    def test_document_skills_alone_unlock_evaluation(self) -> None:
        profile_document.update(self.db_path, skills="- Python\n- FastAPI")
        context = get_candidate_context("match", db_path=self.db_path)
        self.assertTrue(context["confirmed_facts"])
        self.assertTrue(any(item["category"] == "skill" for item in context["confirmed_facts"]))

        create_strategy(
            name="后端",
            target_roles=["后端工程师"],
            is_active=True,
            db_path=self.db_path,
        )
        job = create_job(
            {
                "job_title": "后端工程师",
                "company_name": "示例",
                "description": "负责 Python FastAPI 服务开发与稳定性建设，需要独立交付接口。",
            },
            self.db_path,
        )
        created = create_job_evaluation(job["id"], db_path=self.db_path)
        self.assertTrue(created["id"])

    def test_career_profile_bundle_hides_resume_dictionary_pending_skills(self) -> None:
        self._ingest()
        pending = [item["statement"] for item in get_career_profile(self.db_path)["facts"] if item["status"] == "pending"]
        self.assertNotIn("Python", pending)
        self.assertNotIn("Redis", pending)
        self.assertIn("实时语音链路", pending)

    def test_garbled_skill_wrapper_is_not_reviewable(self) -> None:
        propose_fact(
            category="skill",
            statement="具备 擅长实时语音链路、分布式服务架构、缓存优化与任务调度。 相关经验",
            value={"name": "擅长实时语音链路、分布式服务架构、缓存优化与任务调度。"},
            db_path=self.db_path,
        )
        self.assertEqual(list_review_inbox(db_path=self.db_path), [])
        pending = [
            item["statement"]
            for item in get_career_profile(self.db_path)["facts"]
            if item["status"] == "pending"
        ]
        self.assertEqual(pending, [])

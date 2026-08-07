from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.db import connect, init_db, json_dump
from app.interview_workflow import (
    add_job_event,
    create_interview_kit,
    create_interview_round,
    list_interview_kits,
    list_interview_rounds,
    list_job_events,
    update_interview_kit,
    update_interview_round,
    update_interview_task,
)
from app.jobs import create_job, get_job, update_job
from evaluation_helpers import seed_confirmed_facts_and_evaluation


class InterviewWorkflowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "interview-workflow.db"
        init_db(self.db_path)
        with connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO profiles (
                    name, resume_text, resume_redacted_text, privacy_mode, skills_json
                ) VALUES (?, ?, ?, 'redacted', ?)
                """,
                (
                    "测试用户",
                    "13800138000\n5年产品经验\n负责 Agent 产品规划和需求分析。\n"
                    "推动 RAG 产品落地，使用 Python 和 FastAPI 完成原型。",
                    "[手机号已隐藏]\n5年产品经验\n负责 Agent 产品规划和需求分析。\n"
                    "推动 RAG 产品落地，使用 Python 和 FastAPI 完成原型。",
                    json_dump(["Agent", "RAG", "Python", "FastAPI"]),
                ),
            )
            conn.execute(
                "INSERT INTO preferences (profile_id) VALUES (?)",
                (cursor.lastrowid,),
            )
        self.job = create_job(
            {
                "job_title": "AI 产品经理",
                "company_name": "示例科技",
                "description": (
                    "负责 Agent 产品规划和需求分析；"
                    "要求熟悉 RAG、Python 和 FastAPI；"
                    "要求具备 Kubernetes 集群管理经验。"
                ),
            },
            self.db_path,
        )
        seed_confirmed_facts_and_evaluation(self.job["id"], self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_kit_is_evidence_backed_persistent_and_private(self) -> None:
        kit = create_interview_kit(
            self.job["id"],
            "business",
            self.db_path,
        )

        self.assertEqual(kit["interview_type"], "business")
        self.assertGreaterEqual(kit["task_count"], 5)
        self.assertTrue(kit["content"]["questions"])
        self.assertTrue(
            any(question["evidence"] for question in kit["content"]["questions"])
        )
        self.assertIn("如实说明", kit["content"]["self_intro"])
        self.assertNotIn("13800138000", json_dump(kit))
        self.assertEqual(
            list_interview_kits(self.job["id"], self.db_path)[0]["id"],
            kit["id"],
        )

    def test_user_can_edit_intro_complete_tasks_and_mark_ready(self) -> None:
        kit = create_interview_kit(self.job["id"], db_path=self.db_path)
        task = kit["tasks"][0]

        updated = update_interview_task(
            kit["id"],
            task["id"],
            True,
            self.db_path,
        )
        self.assertEqual(updated["completed_task_count"], 1)
        edited = update_interview_kit(
            kit["id"],
            self_intro="这是我本人确认后的 60 秒自我介绍。",
            notes="重点准备业务案例",
            status="ready",
            db_path=self.db_path,
        )
        self.assertEqual(edited["status"], "ready")
        self.assertTrue(edited["content"]["self_intro_user_edited"])
        self.assertIn("本人确认", edited["content"]["self_intro"])
        self.assertEqual(edited["notes"], "重点准备业务案例")

    def test_rounds_update_job_status_and_timeline(self) -> None:
        kit = create_interview_kit(self.job["id"], db_path=self.db_path)
        interview = create_interview_round(
            self.job["id"],
            kit_id=kit["id"],
            round_type="hr",
            scheduled_at="2026-08-01T10:30",
            interviewer="招聘负责人",
            location="视频会议",
            db_path=self.db_path,
        )

        self.assertEqual(get_job(self.job["id"], self.db_path)["status"], "interviewing")
        self.assertEqual(
            list_interview_rounds(self.job["id"], self.db_path)[0]["id"],
            interview["id"],
        )
        completed = update_interview_round(
            interview["id"],
            status="completed",
            outcome="passed",
            notes="进入业务面",
            db_path=self.db_path,
        )
        self.assertEqual(completed["outcome"], "passed")
        add_job_event(
            self.job["id"],
            "note",
            "发送感谢信息",
            "已通过邮件发送",
            db_path=self.db_path,
        )
        events = list_job_events(self.job["id"], self.db_path)
        event_types = {event["event_type"] for event in events}
        self.assertIn("project_created", event_types)
        self.assertIn("interview_kit_created", event_types)
        self.assertIn("interview_scheduled", event_types)
        self.assertIn("interview_result", event_types)
        self.assertIn("note", event_types)

    def test_changed_job_requires_a_fresh_analysis(self) -> None:
        update_job(
            self.job["id"],
            {"description": "负责全新销售业务，需要渠道管理和销售团队建设经验。"},
            self.db_path,
        )

        with self.assertRaisesRegex(ValueError, "重新生成岗位评估"):
            create_interview_kit(self.job["id"], db_path=self.db_path)


if __name__ == "__main__":
    unittest.main()

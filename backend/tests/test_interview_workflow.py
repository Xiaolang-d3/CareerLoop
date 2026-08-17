import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.db import connect, init_db, json_dump
from app.interview.workflow import (
    _build_kit_content,
    _present_kit_content,
    _resume_material_view,
    add_job_event,
    create_interview_kit,
    create_interview_round,
    get_interview_kit,
    list_interview_kits,
    list_interview_rounds,
    list_job_events,
    update_interview_kit,
    update_interview_round,
    update_interview_task,
)
from app.jobs.service import create_job, get_job, update_job
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
        self.assertEqual(list_interview_kits(db_path=self.db_path)[0]["id"], kit["id"])

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

        self.assertEqual(interview["status"], "scheduled")
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

    def test_kit_can_be_created_from_resume_without_evaluation(self) -> None:
        bare_job = create_job(
            {
                "job_title": "尚未分析的岗位",
                "company_name": "新公司",
                "description": "任意描述，尚未生成评估。",
            },
            self.db_path,
        )

        kit = create_interview_kit(bare_job["id"], db_path=self.db_path)

        self.assertIsNone(kit["evaluation_id"])
        self.assertTrue(kit["content"]["questions"])
        self.assertTrue(
            any("尚未对照岗位分析" in item for item in kit["content"]["limitations"])
        )
        self.assertIn("按简历准备", kit["title"])
        self.assertFalse(kit["content"]["provenance"]["aligned_with_job_analysis"])
        self.assertTrue(
            any("尚未对照岗位分析" in question["reason"] for question in kit["content"]["questions"])
        )

class ResumeOnlyInterviewKitTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "resume-only-interview.db"
        init_db(self.db_path)
        resume = (
            "候选人：李四\nGitHub：https://github.com/lisi\n英语：CET-6\n"
            "具备 Python 相关经验\n具备 FastAPI 相关经验\n"
            "负责支付网关改造，完成对账自动化。"
        )
        with connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO profiles (
                    name, resume_text, resume_redacted_text, privacy_mode, skills_json
                ) VALUES (?, ?, ?, 'redacted', ?)
                """,
                ("李四", resume, resume, json_dump(["Python", "FastAPI"])),
            )
            conn.execute(
                "INSERT INTO preferences (profile_id) VALUES (?)",
                (cursor.lastrowid,),
            )
        self.job = create_job(
            {
                "job_title": "后端工程师",
                "company_name": "示例银行",
                "description": "尚未生成评估的岗位。",
            },
            self.db_path,
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_resume_kit_skips_profile_noise_and_writes_real_questions(self) -> None:
        view = _resume_material_view(
            {"resume_redacted_text": (
                "候选人：李四\nGitHub：https://github.com/lisi\n英语：CET-6\n"
                "具备 Python 相关经验\n具备 FastAPI 相关经验\n"
                "负责支付网关改造，完成对账自动化。"
            )},
            {"confirmed_facts": [
                {
                    "id": 0,
                    "category": "career_goal",
                    "statement": "AI 产品经理，上海，期望 35K",
                    "evidence": [{"excerpt": "AI 产品经理，上海，期望 35K"}],
                },
                {"id": 1, "statement": "候选人：李四", "evidence": []},
                {"id": 2, "statement": "GitHub：https://github.com/lisi", "evidence": []},
                {"id": 3, "statement": "英语：CET-6", "evidence": []},
                {
                    "id": 4,
                    "statement": "具备 Python 相关经验",
                    "evidence": [{"excerpt": "具备 Python 相关经验"}],
                },
                {
                    "id": 5,
                    "statement": "具备 FastAPI 相关经验",
                    "evidence": [{"excerpt": "具备 FastAPI 相关经验"}],
                },
                {
                    "id": 6,
                    "statement": "负责支付网关改造，完成对账自动化。",
                    "evidence": [{"excerpt": "负责支付网关改造，完成对账自动化。"}],
                },
            ]},
        )
        requirement_text = "\n".join(item["text"] for item in view["requirements"])
        self.assertNotIn("GitHub", requirement_text)
        self.assertNotIn("CET-6", requirement_text)
        self.assertNotIn("李四", requirement_text)
        self.assertNotIn("期望 35K", requirement_text)
        self.assertNotIn("AI 产品经理", requirement_text)
        self.assertTrue(any("支付网关" in item["text"] for item in view["requirements"]))

        content, _ = _build_kit_content(
            {"job_title": "后端工程师", "company_name": "示例银行"},
            view,
            "general",
            aligned_with_job=False,
        )
        questions = content["questions"]
        texts = [item["question"] for item in questions]
        blob = "\n".join(texts)
        self.assertTrue(questions)
        self.assertLessEqual(len(questions), 10)
        self.assertNotIn("GitHub", blob)
        self.assertNotIn("期望 35K", blob)
        self.assertNotIn("AI 产品经理", blob)
        self.assertFalse(any(text.startswith("请结合真实经历说明") for text in texts))
        self.assertTrue(all(item.get("category") for item in questions))
        self.assertLessEqual(sum(1 for item in questions if item["category"] == "skill"), 1)
        self.assertTrue(any("支付网关" in text for text in texts))
        self.assertTrue(any("尚未对照岗位分析" in item for item in content["limitations"]))

        kit = create_interview_kit(self.job["id"], db_path=self.db_path)
        kit_texts = [item["question"] for item in kit["content"]["questions"]]
        self.assertTrue(kit["content"]["questions"])
        self.assertFalse(any(text.startswith("请结合真实经历说明") for text in kit_texts))
        self.assertTrue(all(item.get("category") for item in kit["content"]["questions"]))
        self.assertTrue(
            any("尚未对照岗位分析" in item for item in kit["content"]["limitations"])
        )

    def test_legacy_kit_is_polished_on_read(self) -> None:
        kit = create_interview_kit(self.job["id"], db_path=self.db_path)
        with connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT content_json FROM interview_kits WHERE id = ?",
                (kit["id"],),
            ).fetchone()
            content = json.loads(row["content_json"])
            content["questions"] = [
                {
                    "id": "legacy-0",
                    "question": "请结合真实经历说明：AI 产品经理，上海，期望 35K",
                    "reason": "该问题来自已保存简历，尚未对照岗位分析。",
                    "answer_direction": "不要编造",
                    "evidence": ["AI 产品经理，上海，期望 35K"],
                    "status": "matched",
                },
                {
                    "id": "legacy-1",
                    "question": "请结合真实经历说明：GitHub：https://github.com/lisi",
                    "reason": "旧版资料卡",
                    "answer_direction": "不要编造",
                    "evidence": ["GitHub：https://github.com/lisi"],
                    "status": "matched",
                },
                {
                    "id": "legacy-2",
                    "question": "请结合真实经历说明：具备 Python 相关经验",
                    "reason": "旧版资料卡",
                    "answer_direction": "不要编造",
                    "evidence": ["具备 Python 相关经验"],
                    "status": "matched",
                },
                {
                    "id": "legacy-3",
                    "question": "请结合真实经历说明：具备 FastAPI 相关经验",
                    "reason": "旧版资料卡",
                    "answer_direction": "不要编造",
                    "evidence": ["具备 FastAPI 相关经验"],
                    "status": "matched",
                },
                {
                    "id": "legacy-4",
                    "question": "请结合真实经历说明：负责支付网关改造，完成对账自动化。",
                    "reason": "旧版资料卡",
                    "answer_direction": "用 STAR 讲",
                    "evidence": ["负责支付网关改造，完成对账自动化。"],
                    "status": "matched",
                },
            ]
            conn.execute(
                "UPDATE interview_kits SET content_json = ? WHERE id = ?",
                (json_dump(content), kit["id"]),
            )

        loaded = get_interview_kit(kit["id"], self.db_path)
        questions = loaded["content"]["questions"]
        texts = [item["question"] for item in questions]
        blob = "\n".join(texts)

        self.assertNotIn("GitHub", blob)
        self.assertNotIn("期望 35K", blob)
        self.assertNotIn("AI 产品经理", blob)
        self.assertFalse(any(text.startswith("请结合真实经历说明") for text in texts))
        self.assertEqual(sum(1 for item in questions if item.get("category") == "skill"), 1)
        self.assertTrue(any("支付网关" in text for text in texts))
        self.assertTrue(any("Python" in text and "FastAPI" in text for text in texts))

    def test_career_goal_line_is_not_turned_into_a_star_question(self) -> None:
        goal = "AI 产品经理，上海，期望 35K"
        view = _resume_material_view(
            {"resume_redacted_text": goal},
            {"confirmed_facts": [
                {"id": 1, "category": "career_goal", "statement": goal, "evidence": [{"excerpt": goal}]},
            ]},
        )
        self.assertFalse(any(goal in item["text"] for item in view["requirements"]))

        polished = _present_kit_content({
            "questions": [{
                "id": "legacy-goal",
                "question": f"请结合真实经历说明：{goal}",
                "reason": "该问题来自已保存简历，尚未对照岗位分析。",
                "answer_direction": "不要编造",
                "evidence": [goal],
                "status": "matched",
            }],
        })
        blob = "\n".join(item["question"] for item in polished["questions"])
        self.assertNotIn(goal, blob)
        self.assertFalse(any(item["question"].startswith("请结合真实经历说明") for item in polished["questions"]))


if __name__ == "__main__":
    unittest.main()

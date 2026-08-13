from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from docx import Document
from pypdf import PdfReader

from app.db import connect, init_db, json_dump
from app.jobs.service import create_job, update_job
from evaluation_helpers import seed_confirmed_facts_and_evaluation
from app.resume.versions import (
    create_resume_version,
    export_resume_version,
    get_resume_version,
    list_resume_versions,
    update_resume_change,
    update_resume_version,
)


class ResumeVersionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "resume-versions.db"
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
                    "13800138000\n5年产品经验\n负责 Agent 产品规划和需求分析。\n使用 Python 与 FastAPI 完成内部原型。",
                    "[手机号已隐藏]\n5年产品经验\n负责 Agent 产品规划和需求分析。\n使用 Python 与 FastAPI 完成内部原型。",
                    json_dump(["Agent", "Python", "FastAPI"]),
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
                    "要求熟悉 Python 与 FastAPI；"
                    "能够推动产品原型落地。"
                ),
            },
            self.db_path,
        )
        seed_confirmed_facts_and_evaluation(self.job["id"], self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_version_is_persistent_traceable_and_does_not_overwrite_profile(self) -> None:
        version = create_resume_version(self.job["id"], self.db_path)

        self.assertEqual(version["status"], "draft")
        self.assertGreaterEqual(version["change_count"], 3)
        self.assertEqual(version["change_counts"]["pending"], version["change_count"])
        self.assertIn("AI 产品经理", version["rendered_content"])
        self.assertIn("Python", version["rendered_content"])
        self.assertNotIn("13800138000", json_dump(version))
        self.assertTrue(
            all(change["evidence"] for change in version["changes"])
        )
        self.assertEqual(
            list_resume_versions(self.job["id"], self.db_path)[0]["id"],
            version["id"],
        )
        self.assertNotIn(
            "base_content",
            list_resume_versions(self.job["id"], self.db_path)[0],
        )
        with connect(self.db_path) as conn:
            profile = conn.execute("SELECT resume_text FROM profiles").fetchone()
        self.assertIn("13800138000", profile["resume_text"])

    def test_change_decisions_and_user_edits_rebuild_preview(self) -> None:
        version = create_resume_version(self.job["id"], self.db_path)
        summary = next(
            change for change in version["changes"] if change["section_key"] == "summary"
        )

        rejected = update_resume_change(
            version["id"],
            summary["id"],
            decision="rejected",
            db_path=self.db_path,
        )
        self.assertNotIn("简历中可验证的岗位相关能力", rejected["rendered_content"])
        self.assertEqual(rejected["change_counts"]["rejected"], 1)

        edited = update_resume_change(
            version["id"],
            summary["id"],
            decision="accepted",
            after_text="## 职业概述\n这是我本人确认并编辑的职业概述。",
            db_path=self.db_path,
        )
        edited_change = next(
            change for change in edited["changes"] if change["id"] == summary["id"]
        )
        self.assertEqual(edited_change["user_edited"], 1)
        self.assertIn("本人确认", edited["rendered_content"])

        final = update_resume_version(
            version["id"],
            status="final",
            db_path=self.db_path,
        )
        self.assertEqual(final["status"], "final")
        self.assertEqual(
            get_resume_version(version["id"], self.db_path)["status"],
            "final",
        )
        reopened = update_resume_change(
            version["id"],
            summary["id"],
            decision="pending",
            db_path=self.db_path,
        )
        self.assertEqual(reopened["status"], "draft")

    def test_template_is_persisted_per_resume_version(self) -> None:
        version = create_resume_version(self.job["id"], self.db_path)

        self.assertEqual(version["template_id"], "classic")
        updated = update_resume_version(
            version["id"],
            template_id="compact",
            db_path=self.db_path,
        )

        self.assertEqual(updated["template_id"], "compact")
        self.assertEqual(
            get_resume_version(version["id"], self.db_path)["template_id"],
            "compact",
        )
        self.assertEqual(
            list_resume_versions(self.job["id"], self.db_path)[0]["template_id"],
            "compact",
        )

    def test_docx_and_pdf_exports_are_valid_documents(self) -> None:
        version = create_resume_version(self.job["id"], self.db_path)

        docx_bytes, docx_name, docx_type = export_resume_version(
            version["id"],
            "docx",
            self.db_path,
        )
        self.assertTrue(docx_name.endswith(".docx"))
        self.assertIn("wordprocessingml", docx_type)
        document = Document(BytesIO(docx_bytes))
        docx_text = "\n".join(paragraph.text for paragraph in document.paragraphs)
        self.assertIn("AI 产品经理", docx_text)
        self.assertNotIn("13800138000", docx_text)

        pdf_bytes, pdf_name, pdf_type = export_resume_version(
            version["id"],
            "pdf",
            self.db_path,
        )
        self.assertTrue(pdf_bytes.startswith(b"%PDF"))
        self.assertTrue(pdf_name.endswith(".pdf"))
        self.assertEqual(pdf_type, "application/pdf")
        self.assertGreaterEqual(len(PdfReader(BytesIO(pdf_bytes)).pages), 1)

    def test_material_uses_confirmed_facts_instead_of_legacy_resume_text(self) -> None:
        with connect(self.db_path) as conn:
            conn.execute("UPDATE profiles SET resume_redacted_text = ''")
        version = create_resume_version(self.job["id"], self.db_path)
        self.assertIn("Agent 产品规划", version["base_content"])
        self.assertNotIn("13800138000", version["base_content"])

    def test_updated_job_requires_a_fresh_analysis(self) -> None:
        update_job(
            self.job["id"],
            {"description": "负责全新的商业化产品方向，需要销售管理和渠道建设经验。"},
            self.db_path,
        )

        with self.assertRaisesRegex(ValueError, "重新生成岗位评估"):
            create_resume_version(self.job["id"], self.db_path)


if __name__ == "__main__":
    unittest.main()

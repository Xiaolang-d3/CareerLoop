import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.jobs.imports import (
    JobImportError,
    preview_job_screenshot,
    preview_job_text,
    validate_job_import_url,
)


class JobImportTest(unittest.TestCase):
    def test_pasted_text_preview_extracts_fields_and_strips_boss_security_id(self) -> None:
        text = (
            "AI 产品经理\n"
            "公司名称：示例科技\n"
            "工作地点：上海\n"
            "薪资：15-30K\n"
            "职位描述\n"
            "负责企业级 AI 产品规划、客户研究、需求分析以及商业化落地；"
            "任职要求：五年以上产品经验，能够独立推进复杂项目交付。"
        )
        with patch("app.jobs.imports.is_public_source_url", return_value=True):
            result = preview_job_text(
                text,
                source_url=(
                    "https://www.zhipin.com/job_detail/abc.html"
                    "?securityId=temporary"
                ),
            )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["extraction_method"], "manual_text")
        self.assertEqual(result["job_title"], "AI 产品经理")
        self.assertEqual(result["company_name"], "示例科技")
        self.assertEqual(result["location"], "上海")
        self.assertEqual(result["salary_text"], "15-30K")
        self.assertIn("企业级 AI 产品规划", result["description"])
        self.assertEqual(result["source_url"], "https://www.zhipin.com/job_detail/abc.html")
        self.assertNotIn("securityId", result["source_url"])

        ocr_text = (
            "岗位名称：AI 产品经理\n"
            "公司名称：示例科技\n"
            "工作地点：上海\n"
            "薪资：15-30K\n"
            "职位描述\n"
            "负责企业级 AI 产品规划、客户研究、需求分析以及商业化落地；"
            "任职要求：五年以上产品经验，能够独立推进复杂项目交付。"
        )
        ocr_module = SimpleNamespace(
            extract_screenshot_text=lambda filename, content: ocr_text
        )
        with patch.dict(sys.modules, {"app.jobs.screenshot_ocr": ocr_module}):
            result = preview_job_screenshot(
                "job.png",
                b"image-bytes",
                source_url=(
                    "https://www.zhipin.com/job_detail/abc.html"
                    "?securityId=temporary"
                ),
            )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["extraction_method"], "ocr")
        self.assertEqual(result["job_title"], "AI 产品经理")
        self.assertEqual(result["company_name"], "示例科技")
        self.assertEqual(result["salary_text"], "15-30K")
        self.assertIn("企业级 AI 产品规划", result["description"])
        self.assertEqual(result["source_url"], "https://www.zhipin.com/job_detail/abc.html")
        self.assertEqual(result["final_url"], result["source_url"])
        self.assertNotIn("securityId", result["source_url"])
        self.assertNotIn("securityId", result["final_url"])

        with self.assertRaisesRegex(JobImportError, "HTTPS"):
            validate_job_import_url("http://example.com/job")
        with self.assertRaisesRegex(JobImportError, "公开互联网"):
            validate_job_import_url("https://127.0.0.1/job")
        with self.assertRaisesRegex(JobImportError, "标准 HTTPS 端口"):
            validate_job_import_url("https://example.com:8443/job")

if __name__ == "__main__":
    unittest.main()

import unittest
from unittest.mock import patch

from app.jobs.imports import (
    JobImportError,
    parse_job_page,
    preview_job_screenshot,
    preview_job_text,
    validate_job_import_url,
)


class JobImportTest(unittest.TestCase):
    def test_parses_schema_org_job_posting(self) -> None:
        html = """
        <html>
          <head>
            <title>高级产品经理招聘_示例科技-BOSS直聘</title>
            <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "高级产品经理",
              "description": "<p>负责AI产品规划。</p><p>要求5年以上产品经验。</p>",
              "hiringOrganization": {"@type": "Organization", "name": "示例科技"},
              "jobLocation": {
                "@type": "Place",
                "address": {
                  "@type": "PostalAddress",
                  "addressRegion": "上海",
                  "addressLocality": "浦东新区"
                }
              },
              "baseSalary": {
                "@type": "MonetaryAmount",
                "currency": "CNY",
                "value": {"minValue": 30, "maxValue": 45, "unitText": "K/月"}
              }
            }
            </script>
          </head>
          <body><main>职位描述</main></body>
        </html>
        """

        result = parse_job_page(
            html,
            source_url="https://jobs.example.com/123",
        )

        self.assertEqual(result["job_title"], "高级产品经理")
        self.assertEqual(result["company_name"], "示例科技")
        self.assertEqual(result["location"], "上海 浦东新区")
        self.assertEqual(result["salary_text"], "30-45 CNY K/月")
        self.assertIn("负责AI产品规划", result["description"])
        self.assertEqual(result["extraction_method"], "json_ld")

    def test_falls_back_to_visible_job_description(self) -> None:
        html = """
        <html>
          <head>
            <meta property="og:title" content="AI产品经理招聘_示例公司-BOSS直聘">
            <meta name="description" content="寻找有企业服务经验的产品经理">
          </head>
          <body>
            <div>公司名称：示例公司</div>
            <div>工作地点：北京市海淀区</div>
            <section>
              <h2>职位描述</h2>
              <p>负责企业级AI产品规划、用户研究以及商业化落地。</p>
              <p>任职要求：三年以上产品工作经验，能够独立完成需求分析。</p>
            </section>
            <footer>公司介绍</footer>
          </body>
        </html>
        """

        result = parse_job_page(
            html,
            source_url="https://jobs.example.com/456",
        )

        self.assertEqual(result["job_title"], "AI产品经理")
        self.assertEqual(result["company_name"], "示例公司")
        self.assertEqual(result["location"], "北京市海淀区")
        self.assertIn("企业级AI产品规划", result["description"])
        self.assertEqual(result["extraction_method"], "page_text")

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
        with patch("app.jobs.screenshot_ocr.extract_screenshot_text", return_value=ocr_text):
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

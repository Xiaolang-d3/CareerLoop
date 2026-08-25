import unittest

from app.privacy import scan_and_redact, strip_resume_personal_info


class PrivacyTest(unittest.TestCase):
    def test_scan_and_redact_common_resume_pii(self) -> None:
        text = "联系我：13812345678，邮箱 alice@example.com，身份证 110105199001011234"
        findings, redacted = scan_and_redact(text)

        self.assertEqual({item["entity_type"] for item in findings}, {
            "PHONE_NUMBER", "EMAIL_ADDRESS", "CN_ID_CARD"
        })
        self.assertNotIn("13812345678", redacted)
        self.assertNotIn("alice@example.com", redacted)
        self.assertNotIn("110105199001011234", redacted)

    def test_privacy_scan_does_not_change_plain_text(self) -> None:
        text = "擅长 Python、FastAPI 和本地 Agent 系统。"
        findings, redacted = scan_and_redact(text)
        self.assertEqual(findings, [])
        self.assertEqual(redacted, text)

    def test_resume_personal_info_is_removed_without_losing_other_fields(self) -> None:
        text = (
            "李明\n"
            "求职方向：AI 应用研发 电话：13812345678\n"
            "邮箱：candidate@example.com\n"
            "身份证号：110105199001011234\n"
            "微信号：chen-ai\n"
            "地址：湖北省武汉市\n"
            "技能：Python、FastAPI\n"
        )

        findings, clean = strip_resume_personal_info(text)

        self.assertEqual({item["entity_type"] for item in findings}, {
            "PHONE_NUMBER", "EMAIL_ADDRESS", "CN_ID_CARD"
        })
        self.assertIn("求职方向：AI 应用研发", clean)
        self.assertIn("技能：Python、FastAPI", clean)
        self.assertNotIn("李明", clean)
        self.assertNotIn("电话", clean)
        self.assertNotIn("邮箱", clean)
        self.assertNotIn("身份证", clean)
        self.assertNotIn("chen-ai", clean)
        self.assertNotIn("湖北省武汉市", clean)
        self.assertNotIn("已隐藏", clean)

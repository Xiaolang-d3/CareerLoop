import unittest

from app.privacy import scan_and_redact


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

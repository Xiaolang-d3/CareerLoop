from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app import db
from app.agent.model_capabilities import (
    build_model_list,
    infer_model_capabilities,
    infer_tools,
    infer_vision,
)
from app.db import init_db
from app.main import app
from app.models.base import ModelProviderError
from api_client import create_authenticated_client


class ModelCapabilityInferenceTest(unittest.TestCase):
    def test_known_vision_and_text_only_ids(self) -> None:
        self.assertEqual(infer_vision("gpt-4o-mini")["status"], "supported")
        self.assertEqual(infer_vision("gpt-3.5-turbo")["status"], "unsupported")
        self.assertEqual(infer_vision("custom-hosted-model")["status"], "unknown")
        self.assertEqual(infer_tools("text-embedding-3-small")["status"], "unsupported")
        self.assertEqual(infer_tools("gpt-5.5")["status"], "supported")

    def test_model_list_marks_the_configured_default(self) -> None:
        items = build_model_list(
            "gpt-5.5",
            ["gpt-4.1", "gpt-5.5", ""],
            provider="openai",
            base_url="https://api.example.test/v1",
        )
        self.assertEqual(
            [(item["name"], item["is_default"], item["provider_label"]) for item in items],
            [
                ("gpt-5.5", True, "OpenAI 兼容"),
                ("gpt-4.1", False, "OpenAI 兼容"),
            ],
        )

    def test_report_does_not_invent_a_score(self) -> None:
        report = infer_model_capabilities("gpt-4o", provider="openai")
        self.assertEqual(report["vision"]["status"], "supported")
        self.assertEqual(report["streaming"]["source"], "client")
        self.assertFalse(report["probed"])
        self.assertNotIn("score", report)
        self.assertNotIn("87", str(report))


class ModelCapabilitiesApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = db.DB_PATH
        db.DB_PATH = Path(self.temp_dir.name) / "capabilities.db"
        init_db()
        self.client = create_authenticated_client(app)

    def tearDown(self) -> None:
        self.client.close()
        db.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_get_reports_id_based_capabilities(self) -> None:
        response = self.client.get("/agent/models/capabilities", params={"model_name": "gpt-4o"})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["model_name"], "gpt-4o")
        self.assertEqual(payload["vision"]["status"], "supported")
        self.assertEqual(payload["vision"]["source"], "model_id")
        self.assertFalse(payload["probed"])

    def test_probe_without_key_keeps_inference_and_explains(self) -> None:
        with patch(
            "app.api.resources.get_model_connection",
            return_value={"model_name": "custom-model", "model_base_url": "", "api_key": ""},
        ):
            response = self.client.post(
                "/agent/models/capabilities",
                json={"model_name": "custom-model", "probe": True},
            )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["vision"]["status"], "unknown")
        self.assertFalse(payload["probed"])
        self.assertIn("API Key", payload["probe_error"])

    def test_probe_uses_the_provider_when_a_key_is_present(self) -> None:
        with patch(
            "app.api.resources.OpenAICompatibleProvider.probe_vision",
            new=AsyncMock(
                return_value={
                    "status": "supported",
                    "source": "probe",
                    "detail": "服务接受了图片输入，当前模型支持多模态",
                }
            ),
        ):
            response = self.client.post(
                "/agent/models/capabilities",
                json={"model_name": "custom-model", "api_key": "sk-test", "probe": True},
            )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["probed"])
        self.assertEqual(payload["vision"]["source"], "probe")
        self.assertEqual(payload["vision"]["status"], "supported")
        self.assertIsNone(payload["probe_error"])

    def test_probe_connection_errors_do_not_fake_vision_support(self) -> None:
        with patch(
            "app.api.resources.OpenAICompatibleProvider.probe_vision",
            new=AsyncMock(
                side_effect=ModelProviderError("service_unavailable", "无法连接模型服务")
            ),
        ):
            response = self.client.post(
                "/agent/models/capabilities",
                json={"model_name": "gpt-4o", "api_key": "sk-test", "probe": True},
            )
        payload = response.json()
        self.assertFalse(payload["probed"])
        self.assertEqual(payload["vision"]["source"], "model_id")
        self.assertIn("无法连接", payload["probe_error"])


if __name__ == "__main__":
    unittest.main()

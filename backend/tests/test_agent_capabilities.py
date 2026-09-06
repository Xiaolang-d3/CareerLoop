from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import db
from app.db import init_db
from app.main import app
from api_client import create_authenticated_client


class AgentCapabilitiesApiTest(unittest.TestCase):
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

    def test_capabilities_returns_200_when_api_key_missing(self) -> None:
        with patch(
            "app.agent.bootstrap.get_model_connection",
            return_value={
                "model_name": "gpt-5.5",
                "model_base_url": "",
                "model_protocol": "auto",
                "resolved_model_protocol": "openai",
                "api_key": "",
            },
        ):
            response = self.client.get("/agent/capabilities")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIs(payload["configured"], False)
        self.assertEqual(payload["model_providers"], [])
        self.assertTrue(payload["tools"])
        self.assertIn("web_research", payload)
        self.assertIn("API Key", payload.get("setup_message", ""))

    def test_capabilities_marks_configured_when_key_present(self) -> None:
        with patch(
            "app.agent.bootstrap.get_model_connection",
            return_value={
                "model_name": "gpt-5.5",
                "model_base_url": "https://gateway.example.test",
                "model_protocol": "openai",
                "resolved_model_protocol": "openai",
                "api_key": "sk-test",
            },
        ):
            response = self.client.get("/agent/capabilities")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIs(payload["configured"], True)
        self.assertTrue(payload["model_providers"])
        self.assertNotIn("setup_message", payload)

    def test_ag_ui_returns_400_when_api_key_missing(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "未配置模型"}).json()
        with patch(
            "app.agent.bootstrap.get_model_connection",
            return_value={
                "model_name": "gpt-5.5",
                "model_base_url": "",
                "model_protocol": "auto",
                "resolved_model_protocol": "openai",
                "api_key": "",
            },
        ):
            # Clear any cached runtime built under a prior connection.
            from app.agent.bootstrap import reload_agent_components

            reload_agent_components()
            response = self.client.post(
                "/ag-ui",
                json={
                    "threadId": str(conversation["id"]),
                    "runId": "missing-key-run",
                    "state": {},
                    "messages": [
                        {"id": "user-1", "role": "user", "content": "你好"}
                    ],
                    "tools": [],
                    "context": [],
                    "forwardedProps": {},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("API Key", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()

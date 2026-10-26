from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import db
from app.db import init_db
from app.config import Settings
from app.main import app
from api_client import create_authenticated_client


class AgentCapabilitiesApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = db.DB_PATH
        db.DB_PATH = Path(self.temp_dir.name) / "capabilities.db"
        init_db()
        self.client = create_authenticated_client(app)
        from app.agent.settings import save_agent_settings
        save_agent_settings({"model_name": "capability-test-model"})

    def tearDown(self) -> None:
        self.client.close()
        db.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_capabilities_returns_200_when_api_key_missing(self) -> None:
        with patch(
            "app.agent.bootstrap.get_profile_connection",
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
            "app.agent.bootstrap.get_profile_connection",
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

    def test_capabilities_reports_resolved_search_provider_without_credentials(self) -> None:
        for enabled, provider, expected in (
            (True, "auto", "tavily"), (True, "agent_search", "agent_search"),
            (False, "auto", "disabled"),
        ):
            with self.subTest(enabled=enabled, provider=provider), patch(
                "app.agent.bootstrap.get_settings", return_value=Settings(
                    web_research_enabled=enabled, web_search_provider=provider,
                    tavily_api_key="tvly-private-test-key",
                ),
            ), patch("app.agent.bootstrap.get_profile_connection", return_value={
                "model_name": "test-model", "model_base_url": "", "api_key": "",
            }):
                response = self.client.get("/agent/capabilities")
            self.assertEqual(response.status_code, 200)
            search = response.json()["web_research"]
            self.assertEqual(search["enabled"], enabled)
            self.assertEqual(search["provider"], expected)
            self.assertEqual(search["supported_topics"],
                             ["auto", "general", "news", "finance"] if expected == "tavily"
                             else ["auto", "general", "news"] if expected == "agent_search" else [])
            self.assertIs(search["supports_auto_parameters"], expected == "tavily")
            self.assertIs(search["supports_technical_preference"], expected == "tavily")
            self.assertNotIn("tvly-private-test-key", response.text)

    def test_ag_ui_returns_400_when_api_key_missing(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "未配置模型"}).json()
        with patch(
            "app.agent.bootstrap.get_profile_connection",
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

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app import db
from app.db import init_db
from app.main import app
from app.models.base import ModelProviderError
from app.models.openai_compatible import OpenAICompatibleProvider
from api_client import create_authenticated_client


class ModelDiscoveryApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = db.DB_PATH
        db.DB_PATH = Path(self.temp_dir.name) / "discovery.db"
        init_db()
        self.client = create_authenticated_client(app)

    def tearDown(self) -> None:
        self.client.close()
        db.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def discover(self, base_url: str = "https://gateway.example.test", api_key: str = "sk-test"):
        return self.client.post(
            "/agent/models/discover",
            json={"model_base_url": base_url, "api_key": api_key},
        )

    def test_discovery_returns_the_exact_configured_api_root(self) -> None:
        with patch(
            "app.api.resources.OpenAICompatibleProvider.list_models",
            new=AsyncMock(return_value=["gpt-4.1", "gpt-5.5"]),
        ):
            response = self.discover()

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 2)
        self.assertEqual(payload["base_url"], "https://gateway.example.test")
        self.assertIn("gpt-5.5", payload["models"])

    def test_missing_key_asks_for_a_key_instead_of_calling_the_service(self) -> None:
        list_models = AsyncMock(return_value=[])
        with (
            patch(
                "app.api.resources.get_model_connection",
                return_value={"model_name": "gpt-5.5", "model_base_url": "", "api_key": ""},
            ),
            patch("app.api.resources.OpenAICompatibleProvider.list_models", new=list_models),
        ):
            response = self.discover(api_key="")

        self.assertEqual(response.status_code, 400)
        self.assertIn("API Key", response.json()["detail"])
        list_models.assert_not_awaited()

    def test_ollama_discovery_does_not_require_a_key(self) -> None:
        with patch(
            "app.models.ollama_chat.OllamaChatProvider.list_models",
            new=AsyncMock(return_value=["qwen3"]),
        ):
            response = self.client.post(
                "/agent/models/discover",
                json={
                    "model_base_url": "http://localhost:11434",
                    "model_name": "qwen3",
                    "model_protocol": "ollama",
                    "api_key": "",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["protocol"], "ollama")
        self.assertEqual(response.json()["models"], ["qwen3"])

    def test_invalid_catalog_returns_the_reason_not_a_server_error(self) -> None:
        with patch(
            "app.api.resources.OpenAICompatibleProvider.list_models",
            new=AsyncMock(
                side_effect=ModelProviderError(
                    "invalid_model_catalog",
                    "模型目录 https://gateway.example.test/models 没有返回 OpenAI 兼容的模型列表，"
                    "请确认 Base URL 填写的是模型服务的 API 网关地址",
                )
            ),
        ):
            response = self.discover()

        self.assertEqual(response.status_code, 400)
        self.assertIn("模型目录", response.json()["detail"])
        self.assertIn("Base URL", response.json()["detail"])

    def test_retryable_upstream_failure_returns_503_with_the_reason(self) -> None:
        with patch(
            "app.api.resources.OpenAICompatibleProvider.list_models",
            new=AsyncMock(
                side_effect=ModelProviderError(
                    "request_timeout", "模型服务响应超时，请稍后重试", retryable=True
                )
            ),
        ):
            response = self.discover()

        self.assertEqual(response.status_code, 503)
        self.assertIn("超时", response.json()["detail"])

    def test_unexpected_provider_exception_returns_a_readable_502(self) -> None:
        with patch(
            "app.api.resources.OpenAICompatibleProvider.list_models",
            new=AsyncMock(side_effect=RuntimeError("unexpected parse failure")),
        ):
            response = self.discover()

        self.assertEqual(response.status_code, 502)
        detail = response.json()["detail"]
        self.assertIn("https://gateway.example.test/models", detail)
        self.assertNotIn("unexpected parse failure", detail)

    def test_empty_catalog_points_at_manual_entry(self) -> None:
        with patch(
            "app.api.resources.OpenAICompatibleProvider.list_models",
            new=AsyncMock(return_value=[]),
        ):
            response = self.discover()

        self.assertEqual(response.status_code, 404)
        self.assertIn("手动填写", response.json()["detail"])

    def test_html_gateway_response_reaches_the_client_as_a_400(self) -> None:
        """End-to-end guard: an HTML landing page must not surface as a 500."""

        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                text="<html><body>gateway home</body></html>",
                headers={"content-type": "text/html"},
            )

        class MockedUpstreamProvider(OpenAICompatibleProvider):
            def __init__(self, **kwargs: object) -> None:
                super().__init__(**kwargs)  # type: ignore[arg-type]
                self._client._client = httpx.AsyncClient(
                    transport=httpx.MockTransport(handler),
                    base_url=self._client.base_url,
                )

        provider = MockedUpstreamProvider(
            api_key="sk-test",
            model="test-model",
            base_url="https://gateway.example.test",
            timeout_seconds=5,
        )
        with patch("app.api.resources.build_model_provider", return_value=provider):
            response = self.discover()

        self.assertEqual(response.status_code, 400)
        detail = response.json()["detail"]
        self.assertIn("https://gateway.example.test/models", detail)
        self.assertIn("Base URL", detail)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import asyncio
import unittest
from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app.domain import AgentMessage
from app.models.base import ModelProviderError
from app.models.openai_compatible import SYSTEM_PROMPT, OpenAICompatibleProvider


def build_provider_with_upstream(
    handler: Callable[[httpx.Request], httpx.Response],
    base_url: str = "https://gateway.example.test",
) -> OpenAICompatibleProvider:
    """Wire the provider to a mocked transport so no real request leaves the test."""
    provider = OpenAICompatibleProvider(
        api_key="test-key",
        model="test-model",
        base_url=base_url,
        timeout_seconds=5,
    )
    provider._client._client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url=provider._client.base_url,
    )
    return provider


class OpenAICompatibleProviderTest(unittest.TestCase):
    def test_system_prompt_limits_mindmaps_to_explicit_requests(self) -> None:
        self.assertIn("用户明确要求思维导图", SYSTEM_PROMPT)
        self.assertIn("Mermaid mindmap", SYSTEM_PROMPT)
        self.assertIn("普通回答不要默认生成图", SYSTEM_PROMPT)
        self.assertIn("ask_user", SYSTEM_PROMPT)
        self.assertIn("不要猜测后继续", SYSTEM_PROMPT)

    def test_system_prompt_does_not_name_lane_tools(self) -> None:
        for name in (
            "analyze_resume_against_jd",
            "search_resume_evidence",
            "generate_tailored_resume_content",
            "generate_interview_advice",
        ):
            self.assertNotIn(name, SYSTEM_PROMPT)
        self.assertNotIn("waiting_approval", SYSTEM_PROMPT)

    def test_user_message_with_image_urls_uses_multimodal_content_blocks(self) -> None:
        converted = OpenAICompatibleProvider._convert_message(
            AgentMessage(
                role="user",
                content="请读取这张岗位截图",
                payload={"image_urls": ["https://cdn.example.test/job.png?signature=test"]},
            )
        )

        self.assertEqual(converted["role"], "user")
        self.assertEqual(converted["content"][0], {"type": "text", "text": "请读取这张岗位截图"})
        self.assertEqual(
            converted["content"][1],
            {
                "type": "image_url",
                "image_url": {"url": "https://cdn.example.test/job.png?signature=test"},
            },
        )

    def test_list_models_returns_sorted_unique_model_ids(self) -> None:
        provider = OpenAICompatibleProvider(
            api_key="test-key",
            model="test-model",
            base_url="https://models.example.test",
        )
        response = SimpleNamespace(
            data=[
                SimpleNamespace(id="model-b"),
                SimpleNamespace(id="model-a"),
                SimpleNamespace(id="model-b"),
            ]
        )
        with patch.object(
            provider._client.models,
            "list",
            new=AsyncMock(return_value=response),
        ):
            models = asyncio.run(provider.list_models())

        self.assertEqual(models, ["model-a", "model-b"])

    def test_probe_vision_marks_image_rejections_as_unsupported(self) -> None:
        from openai import APIStatusError

        provider = OpenAICompatibleProvider(
            api_key="test-key",
            model="text-only-model",
            base_url="https://models.example.test",
        )
        error = APIStatusError(
            "this model does not support image inputs",
            response=SimpleNamespace(status_code=400, headers={}, request=None),
            body=None,
        )
        error.status_code = 400
        with patch.object(
            provider._client.chat.completions,
            "create",
            new=AsyncMock(side_effect=error),
        ):
            result = asyncio.run(provider.probe_vision())

        self.assertEqual(result["status"], "unsupported")
        self.assertEqual(result["source"], "probe")


class ListModelsUpstreamTest(unittest.TestCase):
    """Every upstream shape must end up as a classified ModelProviderError."""

    def list_models(self, handler, base_url: str = "https://gateway.example.test") -> list[str]:
        provider = build_provider_with_upstream(handler, base_url)
        return asyncio.run(provider.list_models())

    def expect_error(self, handler, base_url: str = "https://gateway.example.test") -> ModelProviderError:
        with self.assertRaises(ModelProviderError) as caught:
            self.list_models(handler, base_url)
        return caught.exception

    def test_base_url_without_v1_still_requests_the_v1_catalog(self) -> None:
        requested: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requested.append(str(request.url))
            return httpx.Response(
                200,
                json={"object": "list", "data": [{"id": "gpt-5.5"}, {"id": "gpt-4.1"}]},
            )

        models = self.list_models(handler, "https://gateway.example.test")

        self.assertEqual(requested, ["https://gateway.example.test/v1/models"])
        self.assertEqual(models, ["gpt-4.1", "gpt-5.5"])

    def test_html_catalog_response_explains_the_base_url_instead_of_crashing(self) -> None:
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                text="<html><body>packy gateway</body></html>",
                headers={"content-type": "text/html"},
            )

        error = self.expect_error(handler)

        self.assertEqual(error.code, "invalid_model_catalog")
        self.assertIn("https://gateway.example.test/v1/models", str(error))
        self.assertIn("Base URL", str(error))
        self.assertFalse(error.retryable)

    def test_json_catalog_without_data_reads_as_an_empty_catalog(self) -> None:
        models = self.list_models(
            lambda _request: httpx.Response(200, json={"object": "list"})
        )

        self.assertEqual(models, [])

    def test_unparsable_catalog_body_explains_the_base_url(self) -> None:
        error = self.expect_error(
            lambda _request: httpx.Response(
                200, text="", headers={"content-type": "application/json"}
            )
        )

        self.assertEqual(error.code, "invalid_model_catalog")

    def test_not_found_catalog_reports_the_upstream_status(self) -> None:
        error = self.expect_error(
            lambda _request: httpx.Response(
                404, text="<html>404</html>", headers={"content-type": "text/html"}
            )
        )

        self.assertEqual(error.code, "provider_error")
        self.assertIn("404", str(error))
        self.assertFalse(error.retryable)

    def test_bad_request_includes_the_upstream_reason(self) -> None:
        error = self.expect_error(
            lambda _request: httpx.Response(
                400,
                json={"error": {"message": "model claude-sonnet-5 does not exist"}},
            )
        )

        self.assertEqual(error.code, "provider_error")
        self.assertIn("400", str(error))
        self.assertIn("does not exist", str(error))

    def test_html_error_body_is_not_shown_to_the_user(self) -> None:
        error = self.expect_error(
            lambda _request: httpx.Response(400, text="<html><body>Bad Gateway</body></html>")
        )

        self.assertEqual(error.code, "provider_error")
        self.assertIn("400", str(error))
        self.assertNotIn("<html", str(error))

    def test_unauthorized_catalog_reports_an_invalid_key(self) -> None:
        error = self.expect_error(
            lambda _request: httpx.Response(401, json={"error": {"message": "bad key"}})
        )

        self.assertEqual(error.code, "authentication_failed")
        self.assertIn("API Key", str(error))

    def test_upstream_timeout_stays_retryable(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("too slow", request=request)

        error = self.expect_error(handler)

        self.assertEqual(error.code, "request_timeout")
        self.assertTrue(error.retryable)

    def test_unreachable_upstream_reports_a_connection_problem(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route", request=request)

        error = self.expect_error(handler)

        self.assertEqual(error.code, "service_unavailable")
        self.assertTrue(error.retryable)


if __name__ == "__main__":
    unittest.main()

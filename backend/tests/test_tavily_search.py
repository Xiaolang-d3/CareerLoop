from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

import httpx

from app.config import Settings, get_settings
from app.research.options import SearchRequest, TECHNICAL_DOMAINS
from app.research.search import build_public_search_client
from app.research.tavily import TavilySearchClient
from app.research.web import AgentSearchClient, WebResearchError
from app.search_options import WebSearchOptions
from app.tools import SearchPublicWebTool, ToolContext


TEST_KEY = "tvly-test-credential"


def public_item(index: int = 1, *, raw: str | None = "网页正文") -> dict:
    return {
        "title": f"公开资料 {index}", "url": f"https://example.com/{index}",
        "content": "搜索摘要", "raw_content": raw, "score": 0.9,
        "published_date": "2026-10-10",
    }


class SearchProviderConfigTest(unittest.TestCase):
    def test_auto_uses_configured_tavily_without_local_agent_search(self) -> None:
        settings = Settings(tavily_api_key=TEST_KEY)
        with patch("app.research.search.AgentSearchClient", side_effect=AssertionError("不应连接本地服务")):
            client = build_public_search_client(settings)
        self.assertIsInstance(client, TavilySearchClient)
        self.assertEqual(settings.resolved_web_search_provider, "tavily")
        self.assertNotIn(TEST_KEY, repr(client))
        self.assertNotIn(TEST_KEY, repr(settings))

    def test_explicit_agent_search_takes_priority_and_auto_without_key_preserves_legacy(self) -> None:
        for settings in (
            Settings(tavily_api_key=TEST_KEY, web_search_provider="agent_search"),
            Settings(), Settings(tavily_api_key="   "),
        ):
            with self.subTest(provider=settings.web_search_provider):
                self.assertEqual(settings.resolved_web_search_provider, "agent_search")
                self.assertIsInstance(build_public_search_client(settings), AgentSearchClient)

    def test_environment_loads_tavily_key_and_explicit_provider(self) -> None:
        get_settings.cache_clear()
        try:
            with patch.dict(os.environ, {"TAVILY_API_KEY": f" {TEST_KEY} ", "WEB_SEARCH_PROVIDER": "auto"}):
                settings = get_settings()
            self.assertEqual(settings.tavily_api_key, TEST_KEY)
            self.assertEqual(settings.resolved_web_search_provider, "tavily")
        finally:
            get_settings.cache_clear()


class TavilySearchTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        # DNS and HTTP are deterministic; no real search key or network is used.
        self.public_urls = patch("app.research.web.socket.getaddrinfo", return_value=[
            (2, 1, 6, "", ("93.184.216.34", 443)),
        ])
        self.public_urls.start()
        self.addCleanup(self.public_urls.stop)

    async def test_search_auth_topic_normalization_safety_and_result_limit(self) -> None:
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"results": [
                {**public_item(), "url": "http://127.0.0.1/private"},
                {**public_item(), "url": "file:///etc/passwd"},
                {**public_item(), "url": "https://[malformed-ipv6/"},
                public_item(1), public_item(1), public_item(2), public_item(3),
            ]})

        client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(respond))
        sources = await client.search("公开新闻", 2, mode="news")
        self.assertEqual(len(sources), 2)
        request = requests[0]
        self.assertEqual(str(request.url), "https://api.tavily.com/search")
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.headers["Authorization"], f"Bearer {TEST_KEY}")
        payload = json.loads(request.content)
        self.assertEqual(payload["max_results"], 2)
        self.assertEqual(payload["topic"], "news")
        self.assertEqual(payload["search_depth"], "basic")
        self.assertFalse(payload["auto_parameters"])
        self.assertFalse(payload["include_answer"])
        self.assertNotIn(TEST_KEY, request.url.query.decode())
        self.assertNotIn(TEST_KEY, request.content.decode())
        self.assertEqual(sources[0]["content"], "网页正文")
        self.assertEqual(sources[0]["snippet"], "搜索摘要")
        self.assertEqual(sources[0]["published_at"], "2026-10-10")
        self.assertEqual(sources[0]["source"], "Tavily")

    async def test_company_category_maps_to_general_without_losing_query(self) -> None:
        payloads = []

        def respond(request):
            payloads.append(json.loads(request.content))
            return httpx.Response(200, json={"results": [public_item()]})

        client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(respond))
        await client.search("示例科技", 3, mode="company")
        self.assertEqual(payloads[0]["query"], "示例科技")
        self.assertEqual(payloads[0]["topic"], "general")

    async def test_structured_search_uses_native_topics_and_basic_auto_parameters(self) -> None:
        for topic, task in (("auto", "company"), ("general", "news"), ("news", "general"), ("finance", "company")):
            requests = []

            def respond(request):
                requests.append(request)
                return httpx.Response(200, json={
                    "results": [public_item()], "auto_parameters": {"topic": "news" if topic == "auto" else topic},
                })

            with self.subTest(topic=topic):
                client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(respond))
                response = await client.search(SearchRequest(query="示例资料", count=3, topic=topic, task_category=task))
                payload = json.loads(requests[0].content)
                self.assertEqual(payload["auto_parameters"], topic == "auto")
                self.assertEqual(payload["search_depth"], "basic")
                if topic == "auto":
                    self.assertNotIn("topic", payload)
                    self.assertIsNone(response.sent_topic)
                    self.assertEqual(response.effective_topic, "news")
                else:
                    self.assertEqual(payload["topic"], topic)
                    self.assertEqual(response.sent_topic, topic)
                    self.assertEqual(response.effective_topic, topic)
                self.assertFalse(payload["include_answer"])
                self.assertEqual(payload["include_raw_content"], "markdown")
                self.assertFalse(payload["include_images"])
                self.assertNotIn("time_range", payload)
                self.assertEqual(response.requested_topic, topic)

    async def test_technical_preference_is_structured_and_query_stays_unchanged(self) -> None:
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"results": [public_item()]})

        client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(respond))
        response = await client.search(SearchRequest(
            query="Python 最新发布", topic="news", source_preference="technical",
        ))
        payload = json.loads(requests[0].content)
        self.assertEqual(payload["query"], "Python 最新发布")
        self.assertNotIn("site:", payload["query"])
        self.assertEqual(payload["include_domains"], list(TECHNICAL_DOMAINS))
        self.assertEqual(payload["include_domains_mode"], "prefer")
        self.assertEqual(payload["topic"], "news")
        self.assertEqual(response.source_preference, "technical")

    async def test_actual_topic_is_unknown_when_service_omits_or_returns_invalid_metadata(self) -> None:
        for metadata in (None, {}, {"topic": "company"}, {"topic": ["news"]}, "news"):
            with self.subTest(metadata=metadata):
                client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, json={"results": [public_item()], "auto_parameters": metadata}),
                ))
                response = await client.search(SearchRequest(query="公开新闻", topic="auto", task_category="news"))
                self.assertIsNone(response.effective_topic)
                self.assertEqual(response.requested_topic, "auto")
                self.assertIsNone(response.sent_topic)

    async def test_explicit_topic_and_different_actual_service_topic_remain_separate(self) -> None:
        client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={
                "results": [public_item()], "auto_parameters": {"topic": "news"},
            }),
        ))
        response = await client.search(SearchRequest(query="公开资料", topic="general"))
        self.assertEqual(response.requested_topic, "general")
        self.assertEqual(response.sent_topic, "general")
        self.assertEqual(response.effective_topic, "news")
        self.assertEqual(len(response.warnings), 1)

    async def test_extract_only_missing_pages_and_preserves_partial_results(self) -> None:
        requests = []

        def respond(request):
            requests.append(request)
            if request.url.path == "/search":
                return httpx.Response(200, json={"results": [
                    public_item(1), public_item(2, raw=None), public_item(3, raw=None),
                ]})
            return httpx.Response(200, json={
                "results": [{"url": "https://example.com/2", "raw_content": "提取正文"},
                            {"url": "https://unrequested.example.com/", "raw_content": "忽略"}],
                "failed_results": [{"url": "https://example.com/3", "error": TEST_KEY}],
            })

        client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(respond))
        sources = await client.search("公开资料", 3)
        enriched, warnings = await client.enrich_sources(sources)
        self.assertEqual(json.loads(requests[1].content)["urls"], ["https://example.com/2", "https://example.com/3"])
        self.assertEqual(enriched[0]["content"], "网页正文")
        self.assertEqual(enriched[1]["content"], "提取正文")
        self.assertEqual(enriched[2]["content"], "")
        self.assertEqual(enriched[2]["snippet"], "搜索摘要")
        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0]["code"], "source_extraction_failed")
        self.assertNotIn(TEST_KEY, str(warnings))
        await client.enrich_sources(enriched[:2])
        self.assertEqual(len(requests), 2)

    async def test_extract_failure_keeps_snippets_with_actionable_warning(self) -> None:
        def respond(request):
            if request.url.path == "/search":
                return httpx.Response(200, json={"results": [public_item(raw=None)]})
            return httpx.Response(432, json={"detail": TEST_KEY})

        client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(respond))
        sources = await client.search("公开资料", 3)
        enriched, warnings = await client.enrich_sources(sources)
        self.assertEqual(enriched, sources)
        self.assertEqual(warnings[0]["code"], "tavily_quota_exceeded")
        self.assertNotIn(TEST_KEY, str(warnings))

    async def test_http_errors_are_specific_and_never_expose_upstream_body(self) -> None:
        for status, code, retryable in (
            (401, "tavily_auth_error", False), (403, "tavily_auth_error", False),
            (432, "tavily_quota_exceeded", False), (433, "tavily_quota_exceeded", False),
            (429, "tavily_rate_limited", True), (500, "tavily_http_error", True),
            (400, "tavily_http_error", False), (302, "tavily_http_error", False),
        ):
            with self.subTest(status=status):
                client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(
                    lambda request: httpx.Response(status, json={"detail": TEST_KEY}),
                ))
                with self.assertRaises(WebResearchError) as raised:
                    await client.search("公开资料", 3)
                self.assertEqual(raised.exception.code, code)
                self.assertEqual(raised.exception.retryable, retryable)
                self.assertNotIn(TEST_KEY, str(raised.exception))

    async def test_timeout_and_connection_failure_are_retryable(self) -> None:
        for error, code in ((httpx.ReadTimeout, "tavily_timeout"), (httpx.ConnectError, "tavily_unavailable")):
            def fail(request):
                raise error(TEST_KEY, request=request)

            client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(fail))
            with self.assertRaises(WebResearchError) as raised:
                await client.search("公开资料", 3)
            self.assertEqual(raised.exception.code, code)
            self.assertTrue(raised.exception.retryable)
            self.assertNotIn(TEST_KEY, str(raised.exception))

    async def test_malformed_and_oversized_responses_are_rejected(self) -> None:
        for response, code in (
            (httpx.Response(200, content=b"not JSON"), "invalid_response"),
            (httpx.Response(200, json=[]), "invalid_response"),
            (httpx.Response(200, json={"results": None}), "invalid_response"),
            (httpx.Response(200, content=b"x" * 3_000_001), "response_too_large"),
        ):
            client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(lambda request: response))
            with self.assertRaises(WebResearchError) as raised:
                await client.search("公开资料", 3)
            self.assertEqual(raised.exception.code, code)

    async def test_tool_uses_auto_tavily_with_evidence_and_no_agent_search_requests(self) -> None:
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"results": [public_item()]})

        # Keep real provider selection while injecting an HTTP transport.
        def make_client(**kwargs):
            return TavilySearchClient(**kwargs, transport=httpx.MockTransport(respond))

        settings = Settings(web_research_enabled=True, tavily_api_key=TEST_KEY)
        with patch("app.research.search.TavilySearchClient", side_effect=make_client), patch(
            "app.research.search.AgentSearchClient", side_effect=AssertionError("不应使用 AgentSearch"),
        ):
            result = await SearchPublicWebTool(settings=settings).execute(
                {"query": "公开资料"}, ToolContext(platform_name="manual"),
            )
        self.assertTrue(result.ok)
        self.assertEqual(result.data["provider"], "tavily")
        self.assertEqual(result.data["evidence_count"], 1)
        self.assertEqual(result.data["sources"][0]["url"], "https://example.com/1")
        self.assertIn("citation_rule", result.data)
        self.assertIn("external_content_notice", result.data)
        self.assertNotIn(TEST_KEY, str(result.model_dump()))
        self.assertEqual(len(requests), 1)

    async def test_tool_user_topic_and_preference_override_model_arguments(self) -> None:
        for topic, category in (("general", "news"), ("news", "company"), ("finance", "company"), ("auto", "news")):
            requests = []

            def respond(request):
                requests.append(request)
                return httpx.Response(200, json={"results": [public_item()], "auto_parameters": {"topic": "finance"}})

            with self.subTest(topic=topic):
                client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(respond))
                result = await SearchPublicWebTool(
                    settings=Settings(web_research_enabled=True, tavily_api_key=TEST_KEY), client=client,
                ).execute(
                    {"query": "示例资料", "category": category, "topic": "news", "source_preference": "none"},
                    ToolContext(platform_name="manual", web_search_options=WebSearchOptions(
                        enabled=True, topic=topic, source_preference="technical", provider="tavily",
                    )),
                )
                self.assertTrue(result.ok)
                payload = json.loads(requests[0].content)
                self.assertEqual(payload["query"], "示例资料")
                self.assertEqual(payload.get("topic"), None if topic == "auto" else topic)
                self.assertEqual(payload["include_domains_mode"], "prefer")
                self.assertEqual(result.data["search_metadata"]["requested_topic"], topic)
                self.assertEqual(result.data["search_metadata"]["effective_topic"], "finance")
                self.assertEqual(result.data["search_metadata"]["source_preference"], "technical")
                self.assertNotIn(TEST_KEY, str(result.model_dump()))

    async def test_retry_preserves_identical_search_parameters(self) -> None:
        requests = []

        def respond(request):
            requests.append(request)
            if len(requests) == 1:
                return httpx.Response(500, json={"detail": TEST_KEY})
            return httpx.Response(200, json={"results": [public_item()]})

        client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(respond))
        with patch("app.tools.search_public_web.asyncio.sleep"):
            result = await SearchPublicWebTool(
                settings=Settings(web_research_enabled=True, tavily_api_key=TEST_KEY), client=client,
            ).execute({"query": "公开资料"}, ToolContext(
                platform_name="manual", web_search_options=WebSearchOptions(enabled=True, topic="finance", provider="tavily"),
            ))
        self.assertTrue(result.ok)
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0].content, requests[1].content)

    async def test_auth_failure_does_not_retry_or_fall_back_to_agent_search(self) -> None:
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(401, json={"detail": TEST_KEY})

        client = TavilySearchClient(TEST_KEY, transport=httpx.MockTransport(respond))
        with patch("app.research.search.AgentSearchClient", side_effect=AssertionError("不能偷偷回退")):
            result = await SearchPublicWebTool(
                settings=Settings(web_research_enabled=True, tavily_api_key=TEST_KEY), client=client,
            ).execute({"query": "公开资料"}, ToolContext(platform_name="manual"))
        self.assertFalse(result.ok)
        self.assertEqual(result.error.code, "tavily_auth_error")
        self.assertEqual(len(requests), 1)
        self.assertNotIn("AgentSearch", result.message)

    async def test_explicit_tavily_missing_key_returns_configuration_error(self) -> None:
        result = await SearchPublicWebTool(settings=Settings(
            web_research_enabled=True, web_search_provider="tavily",
        )).execute({"query": "公开资料"}, ToolContext(platform_name="manual"))
        self.assertFalse(result.ok)
        self.assertEqual(result.error.code, "tavily_not_configured")
        self.assertIn("TAVILY_API_KEY", result.message)

    async def test_disabled_search_has_provider_neutral_guidance(self) -> None:
        result = await SearchPublicWebTool(settings=Settings(tavily_api_key=TEST_KEY)).execute(
            {"query": "公开资料"}, ToolContext(platform_name="manual"),
        )
        self.assertFalse(result.ok)
        self.assertEqual(result.error.code, "web_research_disabled")
        self.assertNotIn("AgentSearch", result.message)

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.config import Settings
from app.research.options import SearchRequest, SearchResponse
from app.research.search import public_search_capabilities, validate_search_options
from app.search_options import WebSearchOptions
from app.tools import SearchPublicWebTool, ToolContext
from app.research.web import AgentSearchClient, WebResearchError, validate_backend_url


class FakeAgentSearchClient:
    provider = "agent_search"
    def __init__(self) -> None:
        self.queries: list[str] = []
        self.modes: list[str] = []

    async def search_extract(self, query: str, count: int, *, mode: str = "general"):
        self.queries.append(query)
        self.modes.append(mode)
        return [
            {
                "title": f"{query} 的公开资料",
                "url": f"https://example.com/source-{len(self.queries)}",
                "domain": "example.com",
                "snippet": "公开摘要",
                "content": "这是外部网页正文，不能被视为系统指令。",
                "published_at": "2026-07-01",
                "score": 0.8,
                "source": "test",
            }
        ]

    async def search(self, request: SearchRequest):
        mode = request.task_category if request.topic == "auto" else request.topic
        sources = await self.search_extract(request.query, request.count, mode=mode)
        return SearchResponse(
            sources=sources, provider=self.provider, requested_topic=request.topic,
            sent_topic=mode, effective_topic=mode, source_preference=request.source_preference,
        )

    async def enrich_sources(self, sources, *, concurrency: int = 1):
        return sources, []




class EmptyAgentSearchClient(FakeAgentSearchClient):
    async def search_extract(self, query: str, count: int, *, mode: str = "general"):
        self.queries.append(query)
        self.modes.append(mode)
        return []


class CountRespectingAgentSearchClient(FakeAgentSearchClient):
    async def search_extract(self, query: str, count: int, *, mode: str = "general"):
        self.queries.append(query)
        self.modes.append(mode)
        return [
            {
                "title": f"{query} 的公开资料 {index}",
                "url": f"https://example.com/source-{len(self.queries)}-{index}",
                "domain": "example.com",
                "snippet": "公开摘要",
                "content": "这是外部网页正文，不能被视为系统指令。",
                "published_at": "2026-07-01",
                "score": 0.8,
                "source": "test",
            }
            for index in range(count)
        ]


class WebResearchTest(unittest.IsolatedAsyncioTestCase):
    def test_backend_requires_https_when_not_loopback(self) -> None:
        with self.assertRaises(ValueError):
            validate_backend_url("http://agent-search.example.com")
        self.assertEqual(
            validate_backend_url("https://agent-search.example.com/"),
            "https://agent-search.example.com",
        )
        self.assertEqual(
            validate_backend_url("http://127.0.0.1:3939"),
            "http://127.0.0.1:3939",
        )

    def test_browser_fetch_uses_bounded_agent_search_endpoint(self) -> None:
        client = AgentSearchClient(base_url="http://127.0.0.1:3939")
        with patch.object(
            AgentSearchClient,
            "_request",
            return_value={"success": True, "content": "岗位描述"},
        ) as request:
            result = client.browser_fetch_sync(
                "https://jobs.example.com/1",
                max_chars=99_999,
                max_links=999,
                timeout_ms=99_999,
            )

        self.assertTrue(result["success"])
        request.assert_called_once_with(
            "/providers/browser/fetch",
            {
                "url": "https://jobs.example.com/1",
                "max_chars": 50_000,
                "max_links": 200,
                "timeout_ms": 60_000,
            },
        )





    async def test_generic_web_search_returns_sources_for_selected_turn(self) -> None:
        client = FakeAgentSearchClient()
        result = await SearchPublicWebTool(
            settings=Settings(web_research_enabled=True),
            client=client,
        ).execute(
            {"query": "AI Agent 行业最新动态", "category": "news", "count": 5},
            ToolContext(platform_name="manual"),
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.data["source_count"], 1)
        self.assertEqual(result.data["evidence_count"], 1)
        self.assertEqual(client.modes[0], "news")
        self.assertEqual(client.queries[0], "AI Agent 行业最新动态")
        self.assertIn("citation_rule", result.data)

    async def test_generic_web_search_company_category_uses_company_mode(self) -> None:
        client = FakeAgentSearchClient()
        result = await SearchPublicWebTool(
            settings=Settings(web_research_enabled=True),
            client=client,
        ).execute(
            {"query": "示例科技", "category": "company", "count": 5},
            ToolContext(platform_name="manual"),
        )

        self.assertTrue(result.ok)
        self.assertEqual(client.modes[0], "company")
        self.assertEqual(client.queries[0], "示例科技")

    async def test_generic_web_search_defaults_to_eight_sources(self) -> None:
        client = CountRespectingAgentSearchClient()
        result = await SearchPublicWebTool(
            settings=Settings(web_research_enabled=True, web_research_max_sources=10),
            client=client,
        ).execute(
            {"query": "AI Agent 行业最新动态"},
            ToolContext(platform_name="manual"),
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.data["source_count"], 8)
        self.assertEqual(result.data["evidence_count"], 8)

    async def test_agent_search_rejects_legacy_technical_soft_preference_before_search(self) -> None:
        client = FakeAgentSearchClient()
        result = await SearchPublicWebTool(
            settings=Settings(web_research_enabled=True),
            client=client,
        ).execute(
            {"query": "Python 异步任务如何排查", "category": "general"},
            ToolContext(platform_name="manual", web_search_mode="technical"),
        )

        self.assertFalse(result.ok)
        self.assertEqual(result.error.code, "web_search_source_preference_unsupported")
        self.assertEqual(client.queries, [])

    async def test_agent_search_manual_topic_overrides_task_hint(self) -> None:
        for topic, category in (("general", "news"), ("news", "company")):
            with self.subTest(topic=topic):
                client = FakeAgentSearchClient()
                result = await SearchPublicWebTool(settings=Settings(web_research_enabled=True), client=client).execute(
                    {"query": "示例科技", "category": category},
                    ToolContext(platform_name="manual", web_search_options=WebSearchOptions(
                        enabled=True, topic=topic, provider="agent_search",
                    )),
                )
                self.assertTrue(result.ok)
                self.assertEqual(client.modes, [topic])
                self.assertEqual(client.queries, ["示例科技"])
                self.assertEqual(result.data["search_metadata"]["effective_topic"], topic)

    async def test_disabled_turn_cannot_be_enabled_by_tool_arguments_or_injected_client(self) -> None:
        client = FakeAgentSearchClient()
        result = await SearchPublicWebTool(settings=Settings(web_research_enabled=True), client=client).execute(
            {"query": "公开资料", "enabled": True, "topic": "finance"},
            ToolContext(platform_name="manual", web_search_options=WebSearchOptions(enabled=False)),
        )
        self.assertFalse(result.ok)
        self.assertEqual(result.error.code, "web_search_not_allowed")
        self.assertEqual(client.queries, [])

    async def test_provider_change_and_unsupported_finance_do_not_make_search_requests(self) -> None:
        for options, code in (
            (WebSearchOptions(enabled=True, provider="tavily"), "web_search_provider_changed"),
            (WebSearchOptions(enabled=True, topic="finance", provider="agent_search"), "web_search_topic_unsupported"),
        ):
            with self.subTest(code=code):
                client = FakeAgentSearchClient()
                result = await SearchPublicWebTool(settings=Settings(web_research_enabled=True), client=client).execute(
                    {"query": "公开资料"}, ToolContext(platform_name="manual", web_search_options=options),
                )
                self.assertFalse(result.ok)
                self.assertEqual(result.error.code, code)
                self.assertEqual(client.queries, [])

    async def test_agent_search_adapter_selects_task_only_when_auto(self) -> None:
        client = AgentSearchClient(base_url="http://127.0.0.1:3939")
        for topic, task, sent in (
            ("auto", "company", "company"), ("auto", "news", "news"),
            ("general", "news", "general"), ("news", "company", "news"),
        ):
            with self.subTest(topic=topic, task=task), patch.object(AgentSearchClient, "_request", return_value={"results": []}) as send:
                response = await client.search(SearchRequest(query="公开资料", count=4, topic=topic, task_category=task))
                send.assert_called_once_with("/search", {"q": "公开资料", "count": 4, "mode": sent})
                self.assertEqual(response.sent_topic, sent)
                self.assertEqual(response.effective_topic, sent)

    async def test_agent_search_adapter_rejects_unsupported_options_before_http(self) -> None:
        client = AgentSearchClient(base_url="http://127.0.0.1:3939")
        for values in ({"topic": "finance"}, {"source_preference": "technical"}):
            with self.subTest(values=values), patch.object(AgentSearchClient, "_request") as send:
                with self.assertRaises(WebResearchError):
                    await client.search(SearchRequest(query="公开资料", **values))
                send.assert_not_called()

    def test_capabilities_are_adapter_support_and_unknown_provider_is_unavailable(self) -> None:
        self.assertEqual(public_search_capabilities("tavily")["supported_topics"], ["auto", "general", "news", "finance"])
        self.assertTrue(public_search_capabilities("tavily")["supports_technical_preference"])
        self.assertFalse(public_search_capabilities("agent_search")["supports_auto_parameters"])
        for provider in ("disabled", "unknown"):
            self.assertEqual(public_search_capabilities(provider)["supported_topics"], [])
            with self.assertRaises(WebResearchError):
                validate_search_options(WebSearchOptions(enabled=True), provider)




if __name__ == "__main__":
    unittest.main()

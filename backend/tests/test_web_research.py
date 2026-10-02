from __future__ import annotations

import unittest
from unittest.mock import patch

from app.config import Settings
from app.tools import SearchPublicWebTool, ToolContext
from app.research.web import AgentSearchClient, validate_backend_url


class FakeAgentSearchClient:
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

    async def search(self, query: str, count: int, *, mode: str = "general"):
        return await self.search_extract(query, count, mode=mode)

    async def enrich_sources(self, sources, *, concurrency: int = 1):
        return sources, []




class EmptyAgentSearchClient(FakeAgentSearchClient):
    async def search(self, query: str, count: int, *, mode: str = "general"):
        self.queries.append(query)
        self.modes.append(mode)
        return []


class CountRespectingAgentSearchClient(FakeAgentSearchClient):
    async def search(self, query: str, count: int, *, mode: str = "general"):
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

    async def test_generic_web_search_can_prioritize_technical_sources(self) -> None:
        client = FakeAgentSearchClient()
        result = await SearchPublicWebTool(
            settings=Settings(web_research_enabled=True),
            client=client,
        ).execute(
            {"query": "Python 异步任务如何排查", "category": "general"},
            ToolContext(platform_name="manual", web_search_mode="technical"),
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.data["search_mode"], "technical")
        self.assertIn("site:stackoverflow.com", client.queries[0])
        self.assertIn("site:docs.python.org", client.queries[0])




if __name__ == "__main__":
    unittest.main()

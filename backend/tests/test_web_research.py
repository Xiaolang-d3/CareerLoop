from __future__ import annotations

import unittest
from unittest.mock import patch

from app.config import Settings
from app.tools import ResearchCompanyTool, SearchPublicWebTool, ToolContext
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


class PartiallyFailingAgentSearchClient(FakeAgentSearchClient):
    async def search(self, query: str, count: int, *, mode: str = "general"):
        if "最新消息" in query:
            self.queries.append(query)
            from app.research.web import WebResearchError

            raise WebResearchError("agent_search_http_error", "临时失败", retryable=True)
        return await super().search(query, count, mode=mode)


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

    async def test_company_research_returns_deduplicated_citable_sources(self) -> None:
        client = FakeAgentSearchClient()
        settings = Settings(web_research_enabled=True, web_research_max_sources=10)
        result = await ResearchCompanyTool(settings=settings, client=client).execute(
            {
                "company_name": "示例科技",
                "city": "上海",
                "industry": "企业服务",
                "focus": ["技术团队"],
            },
            ToolContext(platform_name="manual"),
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.data["source_count"], 5)
        self.assertEqual(result.data["evidence_count"], 5)
        self.assertEqual(result.data["evidence"][0]["source_tier"], 2)
        self.assertEqual(len(client.queries), 5)
        self.assertIn("技术团队", client.queries[0])
        self.assertIn("citation_rule", result.data["research_requirements"])
        self.assertIn("不可信外部内容", result.data["external_content_notice"])

    async def test_company_research_collects_more_than_five_sources(self) -> None:
        client = CountRespectingAgentSearchClient()
        settings = Settings(web_research_enabled=True, web_research_max_sources=10)
        result = await ResearchCompanyTool(settings=settings, client=client).execute(
            {"company_name": "示例科技", "city": "上海"},
            ToolContext(platform_name="manual"),
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.data["source_count"], 8)
        self.assertEqual(result.data["evidence_count"], 8)
        self.assertEqual(len(client.queries), 1)
        self.assertLessEqual(result.data["source_count"], settings.web_research_max_sources)

    async def test_company_research_rejects_invalid_identity(self) -> None:
        result = await ResearchCompanyTool(
            settings=Settings(web_research_enabled=True),
            client=FakeAgentSearchClient(),
        ).execute(
            {"company_name": "A"},
            ToolContext(platform_name="manual"),
        )

        self.assertFalse(result.ok)
        self.assertEqual(result.error.code, "invalid_arguments")

    async def test_company_research_keeps_partial_results_when_one_query_fails(self) -> None:
        client = PartiallyFailingAgentSearchClient()
        result = await ResearchCompanyTool(
            settings=Settings(web_research_enabled=True, web_research_max_sources=10),
            client=client,
        ).execute(
            {"company_name": "示例科技", "city": "杭州"},
            ToolContext(platform_name="manual"),
        )

        self.assertTrue(result.ok)
        self.assertGreater(result.data["source_count"], 0)
        self.assertEqual(len(result.data["search_warnings"]), 1)
        self.assertEqual(
            result.data["search_warnings"][0]["code"],
            "agent_search_http_error",
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

    async def test_boss_job_search_zero_results_is_inconclusive_not_failed(self) -> None:
        client = EmptyAgentSearchClient()
        result = await ResearchCompanyTool(
            settings=Settings(web_research_enabled=True),
            client=client,
        ).execute(
            {
                "company_name": "蔻蔻琪生物科技（杭州）有限公司",
                "city": "杭州",
                "focus": ["BOSS直聘", "招聘岗位"],
            },
            ToolContext(platform_name="manual"),
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.status, "done")
        self.assertEqual(result.data["source_count"], 0)
        self.assertEqual(result.data["search_outcome"]["kind"], "no_public_job_match")
        self.assertIn("site:zhipin.com", client.queries[0])

    async def test_company_search_uses_short_brand_alias(self) -> None:
        client = EmptyAgentSearchClient()
        result = await ResearchCompanyTool(
            settings=Settings(web_research_enabled=True),
            client=client,
        ).execute(
            {"company_name": "蔻蔻琪生物科技有限公司"},
            ToolContext(platform_name="manual"),
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.status, "done")
        self.assertEqual(result.data["search_outcome"]["kind"], "live_search_no_match")
        self.assertIn('"蔻蔻琪" 公司', client.queries)
        self.assertTrue(client.modes)
        self.assertTrue(all(mode == "company" for mode in client.modes))
        self.assertNotIn("请补充公司全称", result.message)


if __name__ == "__main__":
    unittest.main()

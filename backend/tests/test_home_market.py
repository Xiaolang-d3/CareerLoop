from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.feeds import market, service, sources
from test_home_feeds_service import home_workspace, immediate_refresh

NOW = datetime(2026, 10, 22, 2, tzinfo=timezone.utc)


def test_market_discovers_unlisted_vendors_without_a_vendor_quota(monkeypatch):
    calls = []
    monkeypatch.setattr(market, "is_public_source_url", lambda url: url.startswith("https://newlab.test/"))

    class Search:
        async def search(self, request):
            calls.append(request)
            return SimpleNamespace(sources=[
                {"url": f"https://newlab.test/model-{len(calls)}?utm_source=test", "title": f"Introducing Atlas {len(calls)}", "snippet": "A new language model for reasoning", "published_at": "2026-10-21T12:00:00Z"},
                {"url": "https://newlab.test/price", "title": "Atlas model price reduction", "published_at": "2026-10-21T13:00:00Z"},
                {"url": "http://localhost/private", "title": "New AI model", "published_at": "2026-10-21T13:00:00Z"},
                {"url": "https://newlab.test/future", "title": "New model release", "published_at": "2027-01-01T00:00:00Z"},
                {"url": "https://newlab.test/funding", "title": "AI model startup funding", "published_at": "2026-10-21T13:00:00Z"},
            ])

    rows = asyncio.run(market.discover(client=Search(), now=NOW))
    assert len(rows) == 4
    assert all(row["source"] == "newlab.test" for row in rows)
    assert all("utm_source" not in row["url"] for row in rows)
    assert len(calls) == 3
    assert all(request.count == 10 and request.topic == "news" for request in calls)
    assert not any(vendor in " ".join(request.query for request in calls) for vendor in ("OpenAI", "Claude", "Gemini", "DeepSeek"))


def test_market_keeps_healthy_results_but_reports_total_search_failure(monkeypatch):
    monkeypatch.setattr(market, "is_public_source_url", lambda url: True)

    class Search:
        async def search(self, request):
            if "大模型" not in request.query:
                raise ValueError("offline")
            return SimpleNamespace(sources=[{"url": "https://newlab.test/model", "title": "新模型发布"}])

    result = asyncio.run(market.discover(client=Search(), now=NOW))
    assert result[0]["published_at"] is None

    class Failed:
        async def search(self, request):
            raise ValueError("sensitive connection detail")

    with pytest.raises(ValueError, match="全市场模型资讯搜索暂时不可用"):
        asyncio.run(market.discover(client=Failed(), now=NOW))


def test_manual_refresh_reuses_market_discovery_for_six_hours(home_workspace, immediate_refresh, monkeypatch):
    monkeypatch.setattr(market, "enabled", lambda: True)
    calls = []
    monkeypatch.setattr(sources, "fetch_source", lambda source: calls.append(source.adapter) or [])
    service.get_feed()
    assert calls.count("market_search") == 1
    service._last_started.clear()
    service.start_refresh(force=True)
    assert calls.count("market_search") == 1


def test_failed_market_search_does_not_repeat_on_each_manual_refresh(home_workspace, immediate_refresh, monkeypatch):
    monkeypatch.setattr(market, "enabled", lambda: True)
    calls = []

    def fetch(source):
        if source.adapter == "market_search":
            calls.append(source.id)
            raise ValueError("offline")
        return []

    monkeypatch.setattr(sources, "fetch_source", fetch)
    service.get_feed()
    service._last_started.clear()
    service.start_refresh(force=True)
    assert len(calls) == 1


@pytest.mark.parametrize(("publisher", "url"), [("Hugging Face", "https://huggingface.co/blog/atlas"), ("OpenRouter", "https://openrouter.ai/blog/atlas")])
def test_cross_vendor_subscriptions_keep_real_dates(publisher, url):
    rows = sources.parse_rss(f'<rss><channel><item><title>Introducing Atlas: a new language model</title><link>{url}</link><pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>', publisher)
    assert rows[0]["source"] == publisher
    assert rows[0]["published_at"] == "2026-10-21T12:00:00Z"

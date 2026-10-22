"""Bounded cross-vendor discovery through the configured public search service.

Queries describe model events rather than a vendor allowlist. No model, private
workspace data or newly provisioned credentials are used.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..research.options import SearchRequest
from ..research.web import is_public_source_url


def enabled() -> bool:
    from ..config import get_settings

    return bool(getattr(get_settings(), "web_research_enabled", False))


def queries(now: datetime) -> list[str]:
    window = f"{(now - timedelta(days=7)).date()} to {now.date()}"
    return [
        f"{window} new AI language multimodal model release open weights official announcement",
        f"{window} 大模型 新模型 发布 开源 模型能力 评测 API 定价 降价 官方公告",
        f"{window} AI model benchmark leaderboard evaluation API pricing cost change independent results",
    ]


def _client():
    from ..config import get_settings
    from ..research.search import build_public_search_client

    return build_public_search_client(get_settings())


async def discover(*, client=None, now: datetime | None = None) -> list[dict[str, Any]]:
    from . import model_news, sources

    client = client or _client()
    now = now or datetime.now(timezone.utc)
    responses = await asyncio.gather(*(client.search(SearchRequest(query=query, count=10, topic="news", task_category="news")) for query in queries(now)), return_exceptions=True)
    successful = [response for response in responses if not isinstance(response, BaseException)]
    if not successful:
        raise ValueError("全市场模型资讯搜索暂时不可用，已保留已有内容")
    result = {}
    for response in successful:
        for item in response.sources[:10]:
            url, title = item.get("url"), item.get("title")
            if not isinstance(url, str) or not isinstance(title, str) or not title.strip():
                continue
            try:
                if not is_public_source_url(url):
                    continue
                parsed = urlsplit(url)
                query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if not key.casefold().startswith("utm_") and key.casefold() not in {"fbclid", "gclid"}]
                url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", urlencode(query), ""))
            except (ValueError, OSError):
                continue
            published = sources.published_date(item.get("published_at"))
            if published and not now - timedelta(days=7) <= datetime.fromisoformat(published.replace("Z", "+00:00")) <= now:
                continue
            article = {"id": sources._id("article", url), "title": sources._plain(title, 220),
                       "summary": sources._plain(str(item.get("snippet") or item.get("summary") or ""), 320),
                       "url": url, "source": (parsed.hostname or "").removeprefix("www."),
                       "published_at": published, "category": "model", "tags": ["AI"], "image_url": None}
            if model_news.topic(article):
                result.setdefault(article["id"], article)
    return sorted(result.values(), key=lambda item: item["published_at"] or "", reverse=True)


def fetch() -> list[dict[str, Any]]:
    return asyncio.run(discover())

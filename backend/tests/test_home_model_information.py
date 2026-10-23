from __future__ import annotations

import pytest

from app.feeds import curation, model_news, service, sources
from test_home_feeds_service import NOW, home_workspace, immediate_refresh


@pytest.mark.parametrize(("title", "summary", "expected"), [
    ("Introducing Claude Sonnet 5.5", "A new model", "release"),
    ("Qwen3-Next", "", "release"),
    ("混元模型上线", "", "release"),
    ("DeepSeek API price reduction", "", "pricing"),
    ("Gemini benchmark results", "", "evaluation"),
    ("新模型发布", "推理能力评测", "release"),
    ("OpenAI acquires a startup", "A new model company", None),
    ("Claude partnership announcement", "Lower model cost", None),
    ("千问融资动态", "模型发布", None),
    ("New Agent SDK", "Tools for apps", None),
    ("How developers use Claude", "Customer story", None),
    ("New Gemini tools for small business owners", "Explore Gemini AI", None),
])
def test_model_news_focus(title, summary, expected):
    assert model_news.topic({"title": title, "summary": summary}) == expected


def test_home_exposes_filtered_model_news_without_losing_bookmarkable_originals(home_workspace, immediate_refresh, monkeypatch):
    from test_home_feeds_service import ARTICLE

    release = {**ARTICLE, "id": "release", "title": "Introducing a new Claude model"}
    company = {**ARTICLE, "id": "company", "title": "Claude partnership announcement"}
    monkeypatch.setattr(sources, "fetch_source", lambda source: [release, company] if source.kind == "news" else [])
    result = service.get_feed()
    assert {item["id"] for item in result["news"]} == {"release", "company"}
    assert result["model_news"] == [{**release, "category": "release"}]
    assert service.set_item_state("company", {"bookmarked": True})["bookmarks"][0]["item"] == company


def test_curation_policy_covers_independent_evaluations_and_cost_units():
    guidance = curation._skill()
    assert all(word in guidance for word in ("新模型", "第三方", "每百万 token", "融资收购", "SDK"))


def test_model_evaluation_is_not_crowded_out_by_newer_company_news(monkeypatch):
    monkeypatch.setattr(curation, "is_public_source_url", lambda url: True)
    raw = [{"url": f"https://openai.com/news/company-{index}", "title": "Company funding announcement", "published_at": "2026-10-08T10:00:00Z"} for index in range(12)]
    raw.append({"url": "https://artificialanalysis.ai/leaderboards/models", "title": "New model benchmark results", "published_at": "2026-10-07T12:00:00Z"})
    selected, _ = curation._candidates(raw, NOW)
    assert selected[0]["title"] == "New model benchmark results"
    assert len(selected) == 12

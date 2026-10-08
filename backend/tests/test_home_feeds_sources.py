from __future__ import annotations

import json

import httpx
import pytest

from app.feeds import sources


RSS = """<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<item><title>Agent SDK adds tracing</title><description>&lt;p&gt;Inspect tool calls.&lt;/p&gt;</description><link>https://openai.com/index/agent-sdk</link><pubDate>Wed, 07 Oct 2026 12:00:00 GMT</pubDate><media:thumbnail url="https://cdn.openai.com/agent.png" /></item>
<item><title>New MCP tools</title><description>Model Context Protocol support</description><link>https://openai.com/index/mcp-tools</link></item>
<item><title>Agent redirects elsewhere</title><link>https://evil.test/agent</link></item>
</channel></rss>"""

TRENDING = """<html><article class="Box-row">
<div><a href="/login">Star</a></div><h2><a href="/example/agent-kit"><span>example /</span>agent-kit</a></h2>
<p>Agent tools &amp; evaluation</p><span itemprop="programmingLanguage">Python</span>
<a href="/example/agent-kit/stargazers"><svg></svg>12,345</a><a href="/example/agent-kit/forks">678</a>
<span class="float-sm-right">1,234 stars today</span></article>
<article class="Box-row"><h2><a href="/example/other">other</a></h2><p>Unrelated editor</p></article></html>"""

ENGINEERING = """<main><article><a href="/engineering/agent-tools"><img src="https://www-cdn.anthropic.com/tools.svg"/><h2>Agent tools</h2><p>How to build reliable tools.</p></a></article>
<article><a href="/engineering/eval"><h3>Evaluating agents</h3><time dateTime="2026-10-01">Oct 1, 2026</time></a></article></main>"""


def test_rss_preserves_original_summary_image_and_unknown_date():
    result = sources.parse_rss(RSS)
    assert len(result) == 2
    assert result[0]["summary"] == "Inspect tool calls."
    assert result[0]["published_at"] == "2026-10-07T12:00:00Z"
    assert result[0]["image_url"] == "https://cdn.openai.com/agent.png"
    assert result[1]["published_at"] is None
    assert "MCP" in result[1]["tags"]
    assert result[0]["category"] == "agent"
    assert result[1]["category"] == "mcp"
    assert result[0]["id"] == sources.parse_rss(RSS)[0]["id"]


def test_rss_rejects_entity_expansion_and_non_feed():
    with pytest.raises(ValueError):
        sources.parse_rss('<!DOCTYPE rss [<!ENTITY a "x">]><rss/>')
    with pytest.raises(ValueError):
        sources.parse_rss("<html>maintenance</html>")


@pytest.mark.parametrize("period_text", ["1,234 stars today", "1,234 stars this week"])
def test_trending_uses_actual_rank_total_and_period_stars(period_text):
    rows = sources.parse_trending(TRENDING.replace("1,234 stars today", period_text))
    assert rows[0] == {
        "id": rows[0]["id"], "owner": "example", "name": "agent-kit", "description": "Agent tools & evaluation",
        "url": "https://github.com/example/agent-kit", "language": "Python", "stars": 12345, "forks": 678,
        "period_stars": 1234, "rank": 1, "tags": ["Agent", "评测", "开发工具"],
    }
    assert rows[1]["rank"] == 2
    assert rows[1]["period_stars"] is None
    assert rows[1]["stars"] is None


def test_trending_structure_change_is_error_instead_of_empty_success():
    with pytest.raises(ValueError, match="结构"):
        sources.parse_trending("<html>challenge page</html>")


def test_engineering_preserves_date_and_omits_missing_summary():
    items = sources.parse_engineering(ENGINEERING)
    assert items[0]["published_at"] is None
    assert items[0]["summary"] == "How to build reliable tools."
    assert items[0]["image_url"].endswith("tools.svg")
    assert items[1]["published_at"] == "2026-10-01T00:00:00Z"
    assert items[1]["summary"] == ""
    assert items[0]["category"] == "tool"
    assert items[1]["category"] == "eval"


def test_rag_topic_matches_protocol_word_not_storage_substring():
    assert "RAG" not in sources.tags_for("Fast storage for files")
    assert "RAG" in sources.tags_for("A RAG framework")
    assert sources.practice_category("Deploying storage reliably") == "deploy"


def test_releases_skip_prereleases_and_use_evidence_for_compatibility():
    items = sources.parse_releases(json.dumps([
        {"tag_name": "v3-beta", "prerelease": True},
        {"tag_name": "v2", "html_url": "https://github.com/example/sdk/releases/tag/v2", "published_at": "2026-10-02T22:02:27Z", "body": "## Breaking changes\n- Remove legacy calls\n- See migration guide"},
        {"tag_name": "v1", "html_url": "https://github.com/example/sdk/releases/tag/v1", "body": "fix: tracing"},
    ]), "example/sdk")
    assert len(items) == 2
    assert items[0]["version"] == "v2"
    assert items[0]["previous_version"] == "v1"
    assert items[0]["compatibility"] == "breaking"
    assert items[1]["published_at"] is None
    assert items[1]["compatibility"] == "review"


@pytest.mark.parametrize("value", ["https://github.com/openai/sdk", "../repo", "owner/../repo", "owner/repo?x=1", "owner/repo#token", "owner/repo%2Fanything", "owner/..", "localhost/x:y"])
def test_repository_input_cannot_be_arbitrary_url_or_path(value):
    with pytest.raises(ValueError):
        sources.normalize_repository(value)


@pytest.mark.parametrize("value", ["http://github.com/trending", "https://127.0.0.1", "https://github.com.evil.test", "https://user:pass@github.com/trending", "https://github.com:8443/trending"])
def test_fetch_disallows_other_origins_before_opening_connection(value, monkeypatch):
    monkeypatch.setattr(sources.httpx, "Client", lambda **kwargs: pytest.fail("opened a connection"))
    with pytest.raises(ValueError):
        sources._fetch(value)


def test_fetch_stream_has_timeout_size_bound_and_no_redirects(monkeypatch):
    observed = {}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=b"x" * 20))
    real_client = httpx.Client

    def client(**kwargs):
        observed.update(kwargs)
        return real_client(transport=transport, **kwargs)

    monkeypatch.setattr(sources.httpx, "Client", client)
    monkeypatch.setattr(sources, "MAX_RESPONSE_BYTES", 10)
    with pytest.raises(ValueError, match="大小"):
        sources._fetch("https://github.com/trending?since=daily")
    assert observed["follow_redirects"] is False
    assert observed["timeout"].connect == 5


def test_fetch_refuses_redirects(monkeypatch):
    transport = httpx.MockTransport(lambda request: httpx.Response(302, headers={"location": "http://127.0.0.1/secrets"}))
    client_type = httpx.Client
    monkeypatch.setattr(sources.httpx, "Client", lambda **kwargs: client_type(transport=transport, **kwargs))
    with pytest.raises(httpx.HTTPStatusError):
        sources._fetch("https://github.com/trending?since=daily")

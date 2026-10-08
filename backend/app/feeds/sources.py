"""Bounded, allowlisted public source adapters. No model or private data is used."""

from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx


MAX_RESPONSE_BYTES = 2_000_000
REPOSITORY_PATTERN = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9_.-]{1,100}\Z")
TOPICS = ("AI", "Agent", "MCP", "RAG", "评测", "开发工具")
_ALLOWED_FETCH_HOSTS = {"openai.com", "www.anthropic.com", "github.com", "api.github.com"}
_ALLOWED_IMAGE_HOSTS = {"openai.com", "images.ctfassets.net", "cdn.openai.com", "www-cdn.anthropic.com"}


@dataclass(frozen=True)
class Source:
    id: str
    label: str
    kind: str
    url: str
    ttl_seconds: int = 3600
    repo: str | None = None


def configured_sources(repositories: list[str]) -> list[Source]:
    return [
        Source("openai-news", "OpenAI 官方动态", "news", "https://openai.com/news/rss.xml"),
        Source("github-day", "GitHub Trending · 日榜", "github", "https://github.com/trending?since=daily"),
        Source("github-week", "GitHub Trending · 周榜", "github", "https://github.com/trending?since=weekly"),
        Source("anthropic-engineering", "Anthropic 工程实践", "practice", "https://www.anthropic.com/engineering", 43200),
        *[
            Source(f"release:{repo.lower()}", f"{repo} Releases", "stack", f"https://api.github.com/repos/{repo}/releases?per_page=4", repo=repo)
            for repo in repositories
        ],
    ]


def normalize_repository(value: str) -> str:
    repo = value.strip()
    if not REPOSITORY_PATTERN.fullmatch(repo) or repo.split("/")[1] in {".", ".."}:
        raise ValueError("仓库需填写 owner/repo，例如 modelcontextprotocol/python-sdk")
    return repo


def _fetch(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in _ALLOWED_FETCH_HOSTS or parsed.username or parsed.port not in (None, 443):
        raise ValueError("不允许采集该地址")
    # Redirects are deliberately disabled: a public origin cannot redirect the
    # collector into the local network or another unapproved source.
    with httpx.Client(timeout=httpx.Timeout(12, connect=5), follow_redirects=False) as client:
        with client.stream("GET", url, headers={"User-Agent": "CareerLoop-Developer-Home/1.0", "Accept": "application/json, application/xml, text/xml, text/html"}) as response:
            response.raise_for_status()
            if response.is_redirect:
                raise ValueError("来源返回了不支持的重定向")
            declared = response.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > MAX_RESPONSE_BYTES:
                raise ValueError("来源内容超过大小限制")
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > MAX_RESPONSE_BYTES:
                    raise ValueError("来源内容超过大小限制")
            return content.decode("utf-8", errors="replace")


def safe_public_url(value: str | None, *, image: bool = False) -> str | None:
    if not value:
        return None
    parsed = urlsplit(value)
    allowed = _ALLOWED_IMAGE_HOSTS if image else _ALLOWED_FETCH_HOSTS
    if parsed.scheme != "https" or parsed.hostname not in allowed or parsed.username or parsed.port not in (None, 443):
        return None
    return value


def published_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        date = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        try:
            date = parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            return None
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return date.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _id(kind: str, url: str) -> str:
    return f"{kind}:{hashlib.sha256(url.encode()).hexdigest()[:20]}"


def _plain(value: str, limit: int = 320) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", value))).strip()[:limit]


def _contains(text: str, token: str) -> bool:
    if token.isascii() and len(token) <= 3:
        return re.search(rf"(?<![a-z0-9]){re.escape(token)}(?![a-z0-9])", text) is not None
    return token in text


def tags_for(value: str) -> list[str]:
    text = value.casefold()
    mappings = {
        "Agent": ("agent", "智能体", "claude code", "codex"),
        "MCP": ("mcp", "model context protocol"),
        "RAG": ("retrieval", "rag", "检索"),
        "评测": ("eval", "benchmark", "评测"),
        "开发工具": ("sdk", "api", "developer", "framework", "开发", "tool", "coding"),
        "AI": ("ai", "llm", "model", "gpt", "claude", "人工智能", "neural"),
    }
    tags = [tag for tag, tokens in mappings.items() if any(_contains(text, token) for token in tokens)]
    return tags[:3]


def news_category(tags: list[str]) -> str:
    if "MCP" in tags:
        return "mcp"
    if "Agent" in tags:
        return "agent"
    if "开发工具" in tags:
        return "tools"
    return "model"


def practice_category(value: str) -> str:
    text = value.casefold()
    mappings = (
        ("eval", ("eval", "benchmark", "评测")),
        ("rag", ("retrieval", "rag", "检索")),
        ("memory", ("memory", "context", "long-running", "记忆", "上下文")),
        ("obs", ("observability", "tracing", "monitor", "可观测")),
        ("cost", ("cost", "latency", "efficient", "成本", "延迟")),
        ("deploy", ("deploy", "infrastructure", "scaling", "containment", "security", "部署")),
    )
    return next((category for category, tokens in mappings if any(_contains(text, token) for token in tokens)), "tool")


def parse_rss(content: str) -> list[dict[str, Any]]:
    # ElementTree does not fetch external entities; reject declarations to also
    # avoid internal entity expansion from an unexpected source response.
    if "<!DOCTYPE" in content.upper() or "<!ENTITY" in content.upper():
        raise ValueError("来源 XML 格式不受支持")
    root = ET.fromstring(content)
    if root.tag != "rss" or root.find("channel") is None:
        raise ValueError("来源未返回 RSS")
    articles = []
    for item in root.findall("channel/item")[:80]:
        title = _plain(item.findtext("title", ""), 220)
        summary = _plain(item.findtext("description", ""))
        url = safe_public_url(item.findtext("link"))
        tags = tags_for(f"{title} {summary}")
        if not title or not url or not tags:
            continue
        image = None
        for element in item.iter():
            if element.tag.endswith(("thumbnail", "content", "enclosure")):
                image = safe_public_url(element.get("url"), image=True)
                if image:
                    break
        articles.append({
            "id": _id("article", url), "title": title, "summary": summary, "url": url,
            "source": "OpenAI", "published_at": published_date(item.findtext("pubDate")),
            "category": news_category(tags), "tags": tags, "image_url": image,
        })
    return articles[:30]


@dataclass
class _Node:
    tag: str
    attrs: dict[str, str]
    children: list[Any] = field(default_factory=list)

    def all(self, tag: str | None = None) -> list[_Node]:
        result = []
        for child in self.children:
            if isinstance(child, _Node):
                if tag is None or child.tag == tag:
                    result.append(child)
                result.extend(child.all(tag))
        return result

    def text(self) -> str:
        return " ".join(child.text() if isinstance(child, _Node) else child for child in self.children)


class _TreeParser(HTMLParser):
    def __init__(self, content: str):
        super().__init__(convert_charrefs=True)
        self.root = _Node("root", {})
        self.stack = [self.root]
        self.feed(content)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = _Node(tag, {name.lower(): value or "" for name, value in attrs})
        self.stack[-1].children.append(node)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if self.stack[-1].tag not in {"script", "style"}:
            self.stack[-1].children.append(data)


def _number(value: str) -> int | None:
    match = re.search(r"\d[\d,]*", value)
    return int(match.group().replace(",", "")) if match else None


def parse_trending(content: str) -> list[dict[str, Any]]:
    tree = _TreeParser(content).root
    rows = [node for node in tree.all("article") if "Box-row" in node.attrs.get("class", "").split()]
    if not rows:
        raise ValueError("GitHub 榜单结构已变化或暂时不可用")
    result = []
    for rank, row in enumerate(rows, 1):
        headings = row.all("h2")
        links = headings[0].all("a") if headings else []
        if not links:
            continue
        repo = links[0].attrs.get("href", "").strip("/")
        if not REPOSITORY_PATTERN.fullmatch(repo):
            continue
        owner, name = repo.split("/")
        paragraphs = row.all("p")
        description = _plain(paragraphs[0].text()) if paragraphs else ""
        anchors = row.all("a")
        stars = next((_number(node.text()) for node in anchors if node.attrs.get("href") == f"/{repo}/stargazers"), None)
        forks = next((_number(node.text()) for node in anchors if node.attrs.get("href") == f"/{repo}/forks"), None)
        period = next((_number(node.text()) for node in row.all("span") if re.search(r"stars?\s+(today|this week)", node.text())), None)
        language = next((_plain(node.text()) for node in row.all("span") if node.attrs.get("itemprop") == "programmingLanguage"), None)
        result.append({
            "id": _id("repo", f"https://github.com/{repo.lower()}"), "owner": owner, "name": name,
            "description": description, "url": f"https://github.com/{repo}", "language": language,
            "stars": stars, "period_stars": period, "forks": forks, "rank": rank,
            "tags": tags_for(f"{repo} {description}"),
        })
    if not result:
        raise ValueError("GitHub 榜单未包含可识别仓库")
    return result[:25]


def parse_engineering(content: str) -> list[dict[str, Any]]:
    tree = _TreeParser(content).root
    result = []
    seen = set()
    for row in tree.all("article"):
        links = [node for node in row.all("a") if node.attrs.get("href", "").startswith("/engineering/")]
        if not links:
            continue
        link = links[0]
        url = safe_public_url(urljoin("https://www.anthropic.com", link.attrs["href"]))
        headings = link.all("h2") or link.all("h3")
        if not url or not headings or url in seen:
            continue
        seen.add(url)
        title = _plain(headings[0].text(), 220)
        paragraphs = link.all("p")
        dates = link.all("time")
        images = link.all("img")
        summary = _plain(paragraphs[0].text()) if paragraphs else ""
        tags = tags_for(f"{title} {summary}") or ["开发工具"]
        result.append({
            "id": _id("article", url), "title": title,
            "summary": summary, "url": url,
            "source": "Anthropic Engineering", "published_at": published_date(dates[0].attrs.get("datetime")) if dates else None,
            "category": practice_category(f"{title} {summary}"), "tags": tags,
            "image_url": safe_public_url(images[0].attrs.get("src"), image=True) if images else None,
        })
    if not result:
        raise ValueError("工程来源结构已变化或暂时不可用")
    return result[:16]


def parse_releases(content: str, repo: str) -> list[dict[str, Any]]:
    rows = json.loads(content)
    if not isinstance(rows, list):
        raise ValueError("仓库 Release 响应不可用")
    published = [row for row in rows if isinstance(row, dict) and not row.get("draft") and not row.get("prerelease")]
    releases = []
    for index, row in enumerate(published[:3]):
        url = safe_public_url(row.get("html_url"))
        version = _plain(str(row.get("tag_name", "")), 100)
        if not url or not version:
            continue
        body = str(row.get("body") or "")
        changes = []
        for line in body.splitlines():
            text = _plain(re.sub(r"^[\s#*+\-]+", "", line), 220)
            if text and not text.startswith(("http", "![", "[Full Changelog", "Full Changelog")):
                changes.append(text)
            if len(changes) == 3:
                break
        lowered = body.casefold()
        compatibility = "breaking" if "breaking change" in lowered else "migrate" if "migration" in lowered or "migrate" in lowered else "review"
        releases.append({
            "id": _id("release", url), "repo": repo, "name": _plain(str(row.get("name") or version), 160),
            "version": version, "previous_version": str(published[index + 1].get("tag_name")) if index + 1 < len(published) and published[index + 1].get("tag_name") else None,
            "published_at": published_date(row.get("published_at")), "changes": changes,
            "compatibility": compatibility, "url": url,
        })
    return releases


def fetch_source(source: Source) -> list[dict[str, Any]]:
    content = _fetch(source.url)
    if source.kind == "news":
        return parse_rss(content)
    if source.kind == "github":
        return parse_trending(content)
    if source.kind == "practice":
        return parse_engineering(content)
    if source.kind == "stack" and source.repo:
        return parse_releases(content, source.repo)
    raise ValueError("来源类型不受支持")

from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
from dataclasses import dataclass
from http.client import RemoteDisconnected
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import ProxyHandler, Request, build_opener

PROXY_FAKE_IP_NETWORK = ipaddress.ip_network("198.18.0.0/15")


class WebResearchError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def _is_loopback_host(hostname: str) -> bool:
    if hostname.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def validate_backend_url(value: str) -> str:
    parsed = urlparse(value.rstrip("/"))
    if not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("AgentSearch 地址格式不合法")
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("AgentSearch 地址只允许 HTTP 或 HTTPS")
    if parsed.scheme == "http" and not _is_loopback_host(parsed.hostname):
        raise ValueError("非本机 AgentSearch 服务必须使用 HTTPS")
    return value.rstrip("/")


def is_public_source_url(value: str) -> bool:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    if parsed.username or parsed.password or _is_loopback_host(parsed.hostname):
        return False
    try:
        literal_ip = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        literal_ip = None
    if literal_ip is not None:
        return literal_ip.is_global
    if parsed.hostname.lower().endswith((".local", ".internal", ".localhost")):
        return False
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except OSError:
        return False
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address[4][0])
        except ValueError:
            return False
        # Clash and similar local proxies use RFC 2544's 198.18.0.0/15 as
        # synthetic DNS answers. These URLs are returned as citations only;
        # AgentSearch performs the actual fetch under its own SSRF policy.
        if not ip.is_global and ip not in PROXY_FAKE_IP_NETWORK:
            return False
    return True


def build_evidence_bundle(
    sources: list[dict[str, Any]],
    *,
    official_website: str = "",
) -> list[dict[str, Any]]:
    """Turn raw search results into a bounded, ranked evidence set for the model."""
    official_domain = (urlparse(official_website).hostname or "").lower()
    evidence: list[dict[str, Any]] = []
    for index, source in enumerate(sources, start=1):
        domain = str(source.get("domain") or "").lower()
        excerpt = str(source.get("content") or source.get("snippet") or "").strip()[:1600]
        if not excerpt:
            continue
        tier, source_type = _source_classification(domain, official_domain)
        raw_score = source.get("score")
        relevance = float(raw_score) if isinstance(raw_score, (int, float)) else 0.5
        relevance = max(0.0, min(relevance, 1.0))
        published_at = str(source.get("published_at") or "")
        evidence.append(
            {
                "id": f"S{index}",
                "title": source.get("title"),
                "url": source.get("url"),
                "domain": domain,
                "excerpt": excerpt,
                "published_at": published_at,
                "freshness_known": bool(published_at),
                "source_type": source_type,
                "source_tier": tier,
                "relevance_score": round(relevance, 3),
                "query": source.get("query", ""),
            }
        )
    return sorted(
        evidence,
        key=lambda item: (
            item["source_tier"],
            -item["relevance_score"],
            not item["freshness_known"],
        ),
    )


def _source_classification(domain: str, official_domain: str) -> tuple[int, str]:
    if official_domain and (domain == official_domain or domain.endswith(f".{official_domain}")):
        return 1, "official"
    if domain.endswith(".gov.cn") or domain in {
        "gsxt.gov.cn",
        "wenshu.court.gov.cn",
        "zxgk.court.gov.cn",
    }:
        return 1, "government_or_regulator"
    if any(marker in domain for marker in ("court.gov.cn", "creditchina.gov.cn")):
        return 1, "government_or_regulator"
    return 2, "third_party"


@dataclass(frozen=True)
class AgentSearchClient:
    base_url: str
    token: str | None = None
    timeout_seconds: float = 25

    def __post_init__(self) -> None:
        object.__setattr__(self, "base_url", validate_backend_url(self.base_url))

    def browser_fetch_sync(
        self,
        url: str,
        *,
        max_chars: int = 50_000,
        max_links: int = 20,
        timeout_ms: int = 20_000,
    ) -> dict[str, Any]:
        return self._request(
            "/providers/browser/fetch",
            {
                "url": url,
                "max_chars": max(200, min(max_chars, 50_000)),
                "max_links": max(0, min(max_links, 200)),
                "timeout_ms": max(1_000, min(timeout_ms, 60_000)),
            },
        )

    async def search(self, query: str, count: int) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._search_sync, query, count)

    async def enrich_sources(
        self,
        sources: list[dict[str, Any]],
        *,
        concurrency: int = 1,
    ) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
        semaphore = asyncio.Semaphore(max(1, min(concurrency, 5)))

        async def enrich(source: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str] | None]:
            if source.get("content"):
                return source, None
            async with semaphore:
                try:
                    content = await asyncio.to_thread(self._read_source_sync, source["url"])
                except WebResearchError as exc:
                    return source, {
                        "url": source["url"],
                        "code": exc.code,
                        "message": str(exc),
                    }
                except Exception:
                    return source, {
                        "url": source["url"],
                        "code": "source_extraction_failed",
                        "message": "该网页正文暂时无法抓取，已保留搜索摘要",
                    }
            return ({**source, "content": content} if content else source), None

        enriched = await asyncio.gather(*(enrich(source) for source in sources))
        return (
            [source for source, _ in enriched],
            [warning for _, warning in enriched if warning is not None],
        )

    def _search_sync(self, query: str, count: int) -> list[dict[str, Any]]:
        payload = self._request(
            "/search",
            {"q": query, "count": max(1, min(count, 10)), "mode": "general"},
        )
        return self._normalize_search_payload(payload)

    def _read_source_sync(self, url: str) -> str:
        payload = self._request("/read", {"url": url, "max_chars": 5000})
        if not payload.get("success"):
            return ""
        return str(payload.get("content") or "").strip()[:5000]

    def _normalize_search_payload(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        raw_results = payload.get("results", []) if isinstance(payload, dict) else []
        return [
            normalized
            for item in raw_results
            if isinstance(item, dict) and (normalized := self._normalize_result(item)) is not None
        ]

    def _request(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}{path}?{urlencode(params)}" if params else f"{self.base_url}{path}"
        headers = {"Accept": "application/json", "User-Agent": "CareerLoop/0.1"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(url, headers=headers)
        opener = build_opener(ProxyHandler({}))
        try:
            with opener.open(request, timeout=self.timeout_seconds) as response:
                body = response.read(3_000_001)
                if len(body) > 3_000_000:
                    raise WebResearchError("response_too_large", "联网搜索响应超过大小限制")
                decoded = json.loads(body.decode("utf-8"))
                if not isinstance(decoded, dict):
                    raise WebResearchError("invalid_response", "AgentSearch 返回格式不正确")
                return decoded
        except HTTPError as exc:
            retryable = exc.code >= 500 or exc.code == 429
            raise WebResearchError(
                "agent_search_http_error",
                f"AgentSearch 请求失败（HTTP {exc.code}）",
                retryable=retryable,
            ) from exc
        except TimeoutError as exc:
            raise WebResearchError(
                "agent_search_timeout",
                "AgentSearch 搜索或正文抓取超时",
                retryable=True,
            ) from exc
        except (URLError, RemoteDisconnected, ConnectionError, OSError) as exc:
            raise WebResearchError(
                "agent_search_unavailable",
                "无法连接 AgentSearch，请确认本地服务已经启动",
                retryable=True,
            ) from exc
        except json.JSONDecodeError as exc:
            raise WebResearchError("invalid_response", "AgentSearch 返回了无效 JSON") from exc

    @staticmethod
    def _normalize_result(item: dict[str, Any]) -> dict[str, Any] | None:
        url = str(item.get("url") or "").strip()
        if not is_public_source_url(url):
            return None
        title = str(item.get("title") or url).strip()[:300]
        snippet = str(item.get("snippet") or item.get("description") or "").strip()[:1200]
        content = str(
            item.get("content")
            or item.get("text")
            or item.get("markdown")
            or item.get("extracted_content")
            or ""
        ).strip()[:5000]
        published_at = str(
            item.get("published_at") or item.get("publishedDate") or item.get("date") or ""
        ).strip()[:80]
        return {
            "title": title,
            "url": url,
            "domain": urlparse(url).hostname or "",
            "snippet": snippet,
            "content": content,
            "published_at": published_at,
            "score": item.get("score"),
            "source": item.get("source") or item.get("engine") or "",
        }

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, ClassVar

import httpx

from ..version import USER_AGENT
from .options import SearchRequest, SearchResponse, TECHNICAL_DOMAINS, legacy_search_request
from .web import AgentSearchClient, WebResearchError, is_public_source_url


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


@dataclass(frozen=True)
class TavilySearchClient:
    provider: ClassVar[str] = "tavily"
    api_key: str = field(repr=False)
    timeout_seconds: float = 25
    transport: httpx.AsyncBaseTransport | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        if not self.api_key.strip():
            raise WebResearchError(
                "tavily_not_configured",
                "尚未配置 Tavily API Key，请在本地 backend/.env 中填写 TAVILY_API_KEY 并重启后端",
            )

    async def search(
        self, request: SearchRequest | str, count: int | None = None, *, mode: str = "general",
    ) -> SearchResponse | list[dict[str, Any]]:
        legacy = isinstance(request, str)
        if legacy:
            request = legacy_search_request(request, count if count is not None else 8, mode)
        limit = request.count
        parameters: dict[str, Any] = {
            "query": request.query,
            "max_results": limit,
            "search_depth": "basic",
            "auto_parameters": request.topic == "auto",
            "include_answer": False,
            "include_raw_content": "markdown",
            "include_images": False,
        }
        if request.topic != "auto":
            parameters["topic"] = request.topic
        if request.source_preference == "technical":
            parameters["include_domains"] = list(TECHNICAL_DOMAINS)
            parameters["include_domains_mode"] = "prefer"
        payload = await self._request("/search", parameters)
        raw_results = payload.get("results")
        if not isinstance(raw_results, list):
            raise WebResearchError("invalid_response", "Tavily 搜索结果格式不正确")
        sources: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in raw_results:
            if not isinstance(item, dict):
                continue
            try:
                normalized = AgentSearchClient._normalize_result({
                    "url": _text(item.get("url")),
                    "title": _text(item.get("title")),
                    "snippet": _text(item.get("content")),
                    "content": _text(item.get("raw_content")),
                    "published_at": _text(item.get("published_date")),
                    "score": item.get("score"),
                    "source": "Tavily",
                })
            except ValueError:
                continue
            if normalized is None or normalized["url"] in seen:
                continue
            seen.add(normalized["url"])
            sources.append(normalized)
            if len(sources) >= limit:
                break
        if legacy:
            return sources
        returned_parameters = payload.get("auto_parameters")
        returned_topic = returned_parameters.get("topic") if isinstance(returned_parameters, dict) else None
        effective_topic = (
            returned_topic
            if isinstance(returned_topic, str) and returned_topic in {"general", "news", "finance"}
            else None
        )
        warnings = []
        if request.topic != "auto" and effective_topic is not None and effective_topic != request.topic:
            warnings.append("搜索服务返回的实际类别与请求类别不同")
        return SearchResponse(
            sources=sources, provider="tavily", requested_topic=request.topic,
            sent_topic=request.topic if request.topic != "auto" else None,
            effective_topic=effective_topic,
            source_preference=request.source_preference, warnings=warnings,
        )

    async def enrich_sources(
        self,
        sources: list[dict[str, Any]],
        *,
        concurrency: int = 1,
    ) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
        # Search often already supplies raw_content. Extract only missing pages,
        # in one bounded batch, rather than depending on the local AgentSearch.
        missing = list(dict.fromkeys(
            source["url"] for source in sources
            if not source.get("content") and is_public_source_url(source["url"])
        ))[:4]
        if not missing:
            return sources, []
        try:
            payload = await self._request("/extract", {
                "urls": missing,
                "extract_depth": "basic",
                "format": "markdown",
                "include_images": False,
                "timeout": max(1, min(self.timeout_seconds, 10)),
            })
            results = payload.get("results")
            if not isinstance(results, list):
                raise WebResearchError("invalid_response", "Tavily 正文提取结果格式不正确")
        except WebResearchError as exc:
            return sources, [
                {"url": url, "code": exc.code, "message": f"{exc}；已保留搜索摘要"}
                for url in missing
            ]
        content_by_url = {
            item["url"]: _text(item.get("raw_content"))[:5000]
            for item in results
            if isinstance(item, dict) and item.get("url") in missing
        }
        enriched = [
            {**source, "content": content_by_url[source["url"]]}
            if content_by_url.get(source["url"]) else source
            for source in sources
        ]
        # HTTP 200 may contain per-page failures; never present a snippet as a
        # successfully extracted page or expose upstream error bodies.
        warnings = [
            {"url": url, "code": "source_extraction_failed",
             "message": "该网页正文暂时无法提取，已保留搜索摘要"}
            for url in missing if not content_by_url.get(url)
        ]
        return enriched, warnings

    async def _request(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.api_key.strip()}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        try:
            async with httpx.AsyncClient(
                headers=headers, timeout=self.timeout_seconds,
                transport=self.transport, follow_redirects=False,
            ) as client:
                async with client.stream("POST", f"https://api.tavily.com{path}", json=payload) as response:
                    if response.status_code != 200:
                        raise self._http_error(response.status_code)
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 3_000_000:
                            raise WebResearchError("response_too_large", "Tavily 响应超过大小限制")
            decoded = json.loads(body)
            if not isinstance(decoded, dict):
                raise WebResearchError("invalid_response", "Tavily 返回格式不正确")
            return decoded
        except httpx.TimeoutException as exc:
            raise WebResearchError("tavily_timeout", "Tavily 搜索或正文提取超时，请稍后重试", retryable=True) from exc
        except httpx.RequestError as exc:
            raise WebResearchError("tavily_unavailable", "无法连接 Tavily 搜索服务，请检查网络后重试", retryable=True) from exc
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise WebResearchError("invalid_response", "Tavily 返回了无效 JSON") from exc

    @staticmethod
    def _http_error(status: int) -> WebResearchError:
        if status in {401, 403}:
            return WebResearchError("tavily_auth_error", "Tavily API Key 无效或没有访问权限，请检查本地搜索密钥")
        if status in {432, 433}:
            return WebResearchError("tavily_quota_exceeded", "Tavily 搜索额度已用尽或达到用量上限，请检查 Tavily 控制台")
        if status == 429:
            return WebResearchError("tavily_rate_limited", "Tavily 搜索请求过于频繁，请稍后重试", retryable=True)
        return WebResearchError(
            "tavily_http_error", f"Tavily 请求失败（HTTP {status}）", retryable=status >= 500,
        )

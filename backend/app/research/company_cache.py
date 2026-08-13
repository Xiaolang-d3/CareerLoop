from __future__ import annotations

import html
import json
import re
from typing import Any

from ..db import connect


def normalize_company_name(value: str) -> str:
    text = re.sub(r"[（(][^）)]*[）)]", "", value.lower())
    text = re.sub(r"(有限责任公司|股份有限公司|有限公司|公司)$", "", text)
    return re.sub(r"[\W_]+", "", text, flags=re.UNICODE)


def save_company_sources(company_name: str, sources: list[dict[str, Any]]) -> None:
    cache_key = normalize_company_name(company_name)
    if not cache_key or not sources:
        return
    safe_sources = [_normalize_source(source) for source in sources]
    safe_sources = [source for source in safe_sources if source.get("url")]
    if not safe_sources:
        return
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO company_research_cache
                (cache_key, company_name, sources_json, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(cache_key) DO UPDATE SET
                company_name = excluded.company_name,
                sources_json = excluded.sources_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (cache_key, company_name, json.dumps(safe_sources, ensure_ascii=False)),
        )


def load_company_sources(
    company_name: str,
    *,
    max_age_days: int = 14,
) -> tuple[list[dict[str, Any]], str] | None:
    cache_key = normalize_company_name(company_name)
    if not cache_key:
        return None
    cached = _load_dedicated_cache(cache_key, max_age_days=max_age_days)
    if cached is not None:
        return cached

    migrated = _load_from_successful_chat_history(cache_key, max_age_days=max_age_days)
    if migrated is None:
        return None
    sources, cached_at, original_name = migrated
    save_company_sources(original_name or company_name, sources)
    return sources, cached_at


def _load_dedicated_cache(
    cache_key: str,
    *,
    max_age_days: int,
) -> tuple[list[dict[str, Any]], str] | None:
    with connect() as conn:
        row = conn.execute(
            """
            SELECT sources_json, updated_at
            FROM company_research_cache
            WHERE cache_key = ?
              AND datetime(updated_at) >= datetime('now', ?)
            """,
            (cache_key, f"-{max(1, max_age_days)} days"),
        ).fetchone()
    if row is None:
        return None
    try:
        raw_sources = json.loads(row["sources_json"])
    except (TypeError, json.JSONDecodeError):
        return None
    sources = [
        _normalize_source(source)
        for source in raw_sources
        if isinstance(source, dict) and source.get("url")
    ]
    return (sources, str(row["updated_at"])) if sources else None


def _load_from_successful_chat_history(
    cache_key: str,
    *,
    max_age_days: int,
) -> tuple[list[dict[str, Any]], str, str] | None:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT payload_json, created_at
            FROM chat_messages
            WHERE role = 'assistant'
              AND datetime(created_at) >= datetime('now', ?)
              AND payload_json LIKE '%"sources"%'
            ORDER BY id DESC
            LIMIT 100
            """,
            (f"-{max(1, max_age_days)} days",),
        ).fetchall()

    for row in rows:
        try:
            payload = json.loads(row["payload_json"])
        except (TypeError, json.JSONDecodeError):
            continue
        for event in payload.get("agent", {}).get("events", []):
            if not isinstance(event, dict):
                continue
            data = event.get("data")
            if not isinstance(data, dict):
                continue
            identity = data.get("company_identity")
            sources = data.get("sources")
            if not isinstance(identity, dict) or not isinstance(sources, list) or not sources:
                continue
            original_name = str(identity.get("name") or "")
            if normalize_company_name(original_name) != cache_key:
                continue
            normalized_sources = [
                _normalize_source(source)
                for source in sources
                if isinstance(source, dict) and source.get("url")
            ]
            if normalized_sources:
                return normalized_sources, str(row["created_at"]), original_name
    return None


def _normalize_source(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": str(source.get("title") or "")[:300],
        "url": html.unescape(str(source.get("url") or "").strip()),
        "domain": str(source.get("domain") or "")[:300],
        "snippet": str(source.get("snippet") or "")[:1200],
        "content": str(source.get("content") or "")[:5000],
        "published_at": str(source.get("published_at") or "")[:80],
        "score": source.get("score"),
        "source": str(source.get("source") or "")[:100],
        "query": str(source.get("query") or "")[:500],
    }

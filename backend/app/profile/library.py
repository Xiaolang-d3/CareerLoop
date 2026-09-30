"""General library facade; legacy storage names remain to preserve user data."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from . import document
from .candidate_core import active_profile_id, list_facts
from .library_sources import enabled_source_details, list_sources
from ..agent.settings import get_agent_settings
from ..privacy import scan_and_redact


def get_library(db_path: str | Path | None = None) -> dict[str, Any]:
    has_profile = active_profile_id(db_path) is not None
    stored = document.load(db_path) if has_profile else None
    return {
        "profile": {
            "name": stored.name,
            "privacy_mode": stored.privacy_mode,
            "knowledge_revision": stored.knowledge_revision,
        } if stored is not None else None,
        "facts": [
            fact for fact in list_facts(db_path=db_path)
            if fact.get("category") not in {"career_goal", "career_strategy", "job_preference"}
        ] if has_profile else [],
        "sources": list_sources(db_path),
    }


def model_context(db_path: str | Path | None = None) -> dict[str, Any]:
    settings = get_agent_settings(db_path)
    if not settings["profile_memory_enabled"]:
        return {"document": "", "confirmed_facts": [], "sources": [], "disabled": True}
    bundle = get_library(db_path)
    profile = bundle["profile"]
    facts = [
        {"id": fact["id"], "statement": fact["statement"]}
        for fact in bundle["facts"] if fact["status"] == "confirmed"
    ] if settings["knowledge_memory_enabled"] else []
    facts = [{**fact, "statement": scan_and_redact(fact["statement"])[1]} for fact in facts]
    sources = enabled_source_details(db_path)
    excerpts: list[str] = []
    remaining = 12_000
    for source in sources:
        if remaining <= 0:
            break
        content = str(
            source.get("content")
            if source.get("privacy_mode") == "original"
            else source.get("redacted_content")
            or ""
        ).strip()
        if not content:
            continue
        excerpt = content[: min(4_000, remaining)]
        excerpts.append(f"## {source.get('title') or '资料'}\n{excerpt}")
        remaining -= len(excerpt)
    return {
        "document": "\n\n".join(excerpts),
        "document_truncated": any(
            len(str(source.get("content") or "")) > 4_000 for source in sources
        ) or remaining <= 0,
        "confirmed_facts": facts[:100],
        "sources": [
            {
                "id": source["id"],
                "title": source["title"],
                "privacy_mode": source["privacy_mode"],
            }
            for source in sources
        ],
        "profile": {"name": profile["name"]} if profile else None,
    }

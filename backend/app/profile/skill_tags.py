"""Home skill chips: local extract first, optional one-shot model refine."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from ..agent.settings import get_model_connection
from ..config import get_settings
from ..domain import AgentMessage, ModelRequest
from ..models import ModelProviderError, build_model_provider
from ..model_protocol import protocol_requires_api_key
from .intelligence import SKILL_ALIASES, _contains, extract_skill_tags, normalize_skill_tag

_MAX_TAGS = 16
_CACHE: dict[str, list[str]] = {}


def local_skill_tags(text: str) -> list[str]:
    return extract_skill_tags(text)[:_MAX_TAGS]


async def resolve_home_skill_tags(
    text: str,
    *,
    db_path: str | None = None,
) -> dict[str, Any]:
    source = str(text or "").strip()
    local = local_skill_tags(source)
    if not source:
        return {"skills": [], "source": "local"}
    connection = get_model_connection(db_path)
    if protocol_requires_api_key(connection.get("resolved_model_protocol", "openai")) and not connection.get("api_key"):
        return {"skills": local, "source": "local"}
    cache_key = _cache_key(source, connection.get("model_name") or "")
    cached = _CACHE.get(cache_key)
    if cached:
        return {"skills": cached, "source": "model"}
    try:
        refined = await _refine_skill_tags(source, connection)
    except (ModelProviderError, ValueError, json.JSONDecodeError):
        return {"skills": local, "source": "local"}
    accepted = _accept_model_tags(refined, source) or local
    _CACHE[cache_key] = accepted
    return {"skills": accepted, "source": "model"}


def skill_tag_source(*, skills_text: str = "", resume_text: str = "") -> str:
    return "\n".join(part.strip() for part in (skills_text, resume_text) if part.strip())


def _cache_key(text: str, model_name: str) -> str:
    return hashlib.sha256(f"{model_name}\n{text}".encode()).hexdigest()


async def _refine_skill_tags(text: str, connection: dict[str, str]) -> list[str]:
    provider = build_model_provider(
        api_key=connection["api_key"],
        model=connection["model_name"],
        base_url=connection["model_base_url"] or None,
        timeout_seconds=min(get_settings().model_timeout_seconds, 20),
        protocol=connection.get("model_protocol", "auto"),
    )
    response = await provider.generate(ModelRequest(messages=[
        AgentMessage(role="system", content=(
            "你把简历里的技能写成首页标签。只根据原文提取，不补写、不推断。"
            "只返回 JSON，不要 Markdown。"
        )),
        AgentMessage(role="user", content=(
            "从下面的简历或技能描述中提取短技能标签。"
            '只返回 {"skills":["Python","FastAPI"]} 这种 JSON。'
            "每个标签不超过 12 个字，不要句子，不要句号。"
            "不要保留「熟练掌握」「具备」「擅长」「熟悉」「精通」这类前缀。"
            "技术名用通行写法；最多 16 个，按辨识度排序。\n\n"
            f"{text[:8_000]}"
        )),
    ]))
    payload = _decode_json_object(response.content)
    raw = payload.get("skills")
    if not isinstance(raw, list):
        raise ValueError("skills missing")
    return [str(item).strip() for item in raw if str(item).strip()]


def _accept_model_tags(tags: list[str], source: str) -> list[str]:
    accepted: list[str] = []
    seen: set[str] = set()
    lowered = source.lower()
    for raw in tags:
        tag = normalize_skill_tag(raw)
        if not tag:
            continue
        key = tag.casefold()
        if key in seen:
            continue
        if not _tag_supported_by_source(tag, lowered):
            continue
        seen.add(key)
        accepted.append(tag)
        if len(accepted) >= _MAX_TAGS:
            break
    return accepted


def _tag_supported_by_source(tag: str, lowered_source: str) -> bool:
    if _contains(lowered_source, tag.lower()):
        return True
    for canonical, aliases in SKILL_ALIASES.items():
        if tag.casefold() != canonical.casefold():
            continue
        if any(_contains(lowered_source, alias.lower()) for alias in aliases):
            return True
    return False


def _decode_json_object(content: str) -> dict[str, Any]:
    clean = str(content or "").strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", clean, flags=re.IGNORECASE).strip()
    payload = json.loads(clean)
    if not isinstance(payload, dict):
        raise ValueError("not an object")
    return payload

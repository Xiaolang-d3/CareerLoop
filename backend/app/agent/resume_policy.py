from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from ..domain import AgentClarification, AgentRunSnapshot, ToolEvent
from .orchestration import detect_kind

ABANDON_PHRASES = (
    "先别管",
    "换个话题",
    "不要继续",
    "先不做",
    "不管这个了",
    "聊点别的",
    "先别问",
)


def _normalize_reply(text: str) -> str:
    return " ".join((text or "").split()).casefold()


def clarification_from_payload(raw: Any) -> AgentClarification | None:
    if not isinstance(raw, dict):
        return None
    question = raw.get("question")
    options = raw.get("options")
    has_question = isinstance(question, str) and bool(question.strip())
    if not has_question and not options:
        return None
    try:
        return AgentClarification.model_validate(raw)
    except ValidationError:
        return None


def clarification_from_events(events: list[ToolEvent]) -> AgentClarification | None:
    for event in reversed(events):
        found = clarification_from_payload(event.data.get("clarification"))
        if found is not None:
            return found
    return None


def _reply_candidates(text: str) -> list[str]:
    stripped = (text or "").strip()
    if not stripped:
        return []
    first_line = stripped.split("\n", 1)[0].strip()
    if first_line and first_line != stripped:
        return [stripped, first_line]
    return [stripped]


def matches_clarification_option(text: str, snapshot: AgentRunSnapshot) -> bool:
    clarification = snapshot.clarification
    if clarification is None or not clarification.options:
        return False
    needles = {
        normalized
        for candidate in _reply_candidates(text)
        if (normalized := _normalize_reply(candidate))
    }
    if not needles:
        return False
    for option in clarification.options:
        for value in (option.label, option.send):
            normalized = _normalize_reply(value)
            if normalized and normalized in needles:
                return True
    return False


def is_explicit_abandon(text: str) -> bool:
    normalized = _normalize_reply(text)
    if not normalized:
        return False
    return any(phrase in normalized for phrase in ABANDON_PHRASES)


def should_abandon_snapshot(
    text: str,
    snapshot: AgentRunSnapshot,
    *,
    routing_text: str | None = None,
) -> bool:
    if matches_clarification_option(text, snapshot):
        return False
    if is_explicit_abandon(text):
        return True
    kind = detect_kind(routing_text or text)
    return kind not in {"conversation", snapshot.route_kind}


def resolve_resume_snapshot(
    text: str,
    snapshot: AgentRunSnapshot | None,
    *,
    routing_text: str | None = None,
) -> AgentRunSnapshot | None:
    if snapshot is None:
        return None
    if should_abandon_snapshot(text, snapshot, routing_text=routing_text):
        return None
    return snapshot

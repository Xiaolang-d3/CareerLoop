from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from ..domain import AgentClarification, AgentMessage, AgentRunSnapshot, ToolEvent
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
    if snapshot.pending_search_queries:
        # The run is paused on an external-send confirmation. The reply is
        # interpreted as approve/decline/custom query, never as a new topic;
        # keyword routing must not hijack replies that merely mention 联网.
        return False
    if snapshot.pending_tool_approval is not None:
        # The run is paused on a tool confirmation card. Any reply that is not
        # an explicit abandon stays on the card until it is answered.
        return False
    if snapshot.clarification is not None:
        # An explicit new image request starts a fresh run and model binding.
        # Pending tool and search approvals above must never be bypassed.
        from ..chat.image_assets import image_generation_intent

        if image_generation_intent(text):
            return True
        # An answer can change sources without abandoning the original goal.
        # The runtime re-understands ordinary replies instead of freezing a lane.
        return False
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


def needs_reply_replanning(snapshot: AgentRunSnapshot) -> bool:
    """A clarification answer may change scope even when the lane stays the same.

    Reconnection and pending approvals retain their immutable plan/permissions.
    Ordinary clarification answers get a fresh source and plan assessment.
    """
    return (
        snapshot.resume_mode == "waiting_user"
        and not snapshot.pending_search_queries
        and snapshot.pending_tool_approval is None
    )


def user_intent_preview(message: AgentMessage) -> str:
    # Attachment excerpts are source data, not a preview of the user's intent.
    # A partial excerpt can otherwise be mistaken for a truncated source file.
    prefix = "\n\n以下为用户主动上传附件的本地解析文本，请基于此内容回答：\n"
    request, marker, _ = message.content.partition(prefix)
    return request[:1000] + ("\n（附件全文保留在执行上下文中，此处仅展示用户请求。）" if marker else "")


def clarification_context(snapshot: AgentRunSnapshot) -> tuple[str, list[AgentMessage], bool]:
    """Preserve user intent without carrying the obsolete plan into a new run."""
    user_messages = [message for message in snapshot.messages if message.role == "user"]
    recent_start = max(0, len(user_messages) - 4)
    # Routing gets a bounded intent preview; execution must retain the source
    # text, including attachments needed across several clarification turns.
    context = "\n".join(user_intent_preview(message) for message in user_messages[-4:])
    history = [AgentMessage(role="user", content=message.content,
                            payload={"document_attachment_ids": message.payload["document_attachment_ids"]}
                            if message.payload.get("document_attachment_ids") else {})
               for index, message in enumerate(user_messages)
               if index >= recent_start or message.payload.get("document_attachment_ids")
               or "\n[脱敏资料：" in message.content]
    if snapshot.clarification is not None:
        question = snapshot.clarification.question[:200]
        options = "；".join(
            f"{index}. {option.label[:40]}：{option.send[:200]}"
            for index, option in enumerate(snapshot.clarification.options[:6], start=1)
        )
        if options:
            question += f"\n选项：{options}"
        context += f"\n上轮待澄清问题：{question}"
        history.append(AgentMessage(role="assistant", content=question))
    # A clarification itself can mention private facts read in the previous run.
    private_context = snapshot.requires_query_approval or bool(
        {"get_library_context", "search_library"} & set(snapshot.completed_tools)
    )
    return context, history, private_context

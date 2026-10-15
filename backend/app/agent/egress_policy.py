from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Iterable


APPROVE_OPTION_LABEL = "允许发送这条查询"
DECLINE_OPTION_LABEL = "不联网，仅用本地资料"
EXTERNAL_QUERY_NOT_APPROVED = "external_query_not_approved"
APPROVAL_REQUIRED = "external_query_approval_required"
SEARCH_TOOL_NAME = "search_public_web"
MAX_QUERY_LENGTH = 500


def normalize_query(text: str) -> str:
    return " ".join((text or "").split()).casefold()


def query_digest(text: str) -> str:
    """Stable, opaque audit identity for one outgoing query."""
    return hashlib.sha256(normalize_query(text).encode("utf-8")).hexdigest()


@dataclass
class EgressState:
    """Run-bound external-send approvals. Contains queries only, never payloads."""

    mixed: bool = False
    approved: list[str] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)

    def allows(self, query: str) -> bool:
        if not self.mixed:
            return True
        normalized = normalize_query(query)
        return bool(normalized) and normalized in {
            normalize_query(item) for item in self.approved
        }

    def approve(self, queries: Iterable[str]) -> None:
        known = {normalize_query(item) for item in self.approved}
        for query in queries:
            normalized = normalize_query(query)
            if normalized and normalized not in known:
                self.approved.append(query.strip())
                known.add(normalized)
        self.pending = []

    def hold(self, query: str) -> None:
        self.pending = [query.strip()] if query.strip() else []

    def revoke(self) -> None:
        self.mixed = False
        self.approved = []
        self.pending = []


@dataclass(frozen=True)
class EgressDecision:
    approved_queries: tuple[str, ...] = ()
    declined: bool = False


def approval_payload(query: str) -> dict:
    """Structured pause payload consumed by the chat composer."""
    question = (
        "联网搜索会把下面这条查询发送给公开搜索服务：\n"
        f"“{query}”\n"
        "是否允许发送？"
    )
    options = [
        {"id": "opt_1", "label": APPROVE_OPTION_LABEL, "send": APPROVE_OPTION_LABEL},
        {"id": "opt_2", "label": DECLINE_OPTION_LABEL, "send": DECLINE_OPTION_LABEL},
    ]
    return {
        "clarification": {
            "question": question,
            "options": options,
            "allow_custom": True,
        }
    }


def resolve_egress_reply(text: str, pending: Iterable[str]) -> EgressDecision:
    """Interpret a reply to an external-send confirmation.

    Clicking approve approves exactly the pending query. Clicking decline
    revokes web access for this run. Any other non-empty text is treated as a
    query the user supplied themselves.
    """
    reply = " ".join((text or "").split())
    if not reply:
        return EgressDecision()
    if reply.casefold() == APPROVE_OPTION_LABEL.casefold():
        return EgressDecision(approved_queries=tuple(pending))
    if reply.casefold() == DECLINE_OPTION_LABEL.casefold():
        return EgressDecision(declined=True)
    if len(reply) > MAX_QUERY_LENGTH:
        return EgressDecision()
    return EgressDecision(approved_queries=(reply,))


def mixed_run_notice() -> str:
    return (
        "本任务同时使用本地资料与公开联网搜索。每次调用 search_public_web 前，"
        "系统会把将要发送的完整查询字符串展示给用户确认；未经确认的查询不会发送，"
        "也不要把本地资料内容拼进查询，除非用户自己明确提供了该查询。"
    )

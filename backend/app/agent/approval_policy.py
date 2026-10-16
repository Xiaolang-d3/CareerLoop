"""Generic confirmation seam for tools that touch confirmed local data.

One run-bound state holds fingerprints the user approved and the single held
call whose confirmation card is on screen. Cards reuse the composer's existing
clarification payload, so tools never render their own approval UI.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..domain import PendingToolApproval

APPROVE_OPTION_LABEL = "允许执行这个操作"
DECLINE_OPTION_LABEL = "不要执行这个操作"
TOOL_APPROVAL_REQUIRED = "tool_approval_required"
MAX_SUMMARY_KEYS = 8
MAX_SUMMARY_VALUE_LENGTH = 120
MAX_SUMMARY_LENGTH = 500


def arguments_summary(arguments: dict[str, Any]) -> str:
    """Render scalar-only call arguments for a confirmation card.

    Nested structures are summarized by size, never dumped, so one held call
    cannot leak private payloads into the pause message or snapshot.
    """
    parts: list[str] = []
    for key, value in list(arguments.items())[:MAX_SUMMARY_KEYS]:
        if isinstance(value, bool):
            text = "是" if value else "否"
        elif isinstance(value, (int, float)):
            text = str(value)
        elif isinstance(value, str):
            text = " ".join(value.split())
        elif isinstance(value, (list, tuple, set)):
            text = f"共 {len(value)} 项"
        else:
            continue
        if not text:
            continue
        if len(text) > MAX_SUMMARY_VALUE_LENGTH:
            text = text[: MAX_SUMMARY_VALUE_LENGTH - 1] + "…"
        parts.append(f"{key}={text}")
    summary = "，".join(parts)
    if len(summary) > MAX_SUMMARY_LENGTH:
        summary = summary[: MAX_SUMMARY_LENGTH - 1] + "…"
    return summary


def approval_payload(title: str, summary: str = "") -> dict:
    """Structured pause payload consumed by the chat composer."""
    details = f"\n{summary}" if summary else ""
    question = f"“{title}”会修改本地数据并需要你确认：{details}\n是否允许执行？"
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


@dataclass(frozen=True)
class ApprovalDecision:
    approved: bool = False
    declined: bool = False


def resolve_approval_reply(text: str) -> ApprovalDecision:
    """Interpret a reply to a tool confirmation card.

    Only the two card options count; any other text leaves the call held and
    the card is shown again.
    """
    reply = " ".join((text or "").split())
    if not reply:
        return ApprovalDecision()
    if reply.casefold() == APPROVE_OPTION_LABEL.casefold():
        return ApprovalDecision(approved=True)
    if reply.casefold() == DECLINE_OPTION_LABEL.casefold():
        return ApprovalDecision(declined=True)
    return ApprovalDecision()


@dataclass
class ToolApprovalState:
    """Run-bound approvals for confirmation-required tools, by fingerprint."""

    approved: list[str] = field(default_factory=list)
    pending: PendingToolApproval | None = None

    def allows(self, fingerprint: str) -> bool:
        return bool(fingerprint) and fingerprint in self.approved

    def approve(self, fingerprint: str) -> None:
        if fingerprint and fingerprint not in self.approved:
            self.approved.append(fingerprint)
        self.pending = None

    def hold(self, pending: PendingToolApproval) -> None:
        self.pending = pending

    def clear_pending(self) -> None:
        self.pending = None

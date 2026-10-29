"""Bound execution using observed work, independently of the model's plan."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from time import monotonic

from ..domain import AgentMessage, ExecutionBudgetState, ToolResult
from .citations import canonical_url


@dataclass(frozen=True)
class ExecutionLimits:
    max_tool_calls: int = 16
    max_web_search_calls: int = 6
    max_active_seconds: float = 120
    max_searches_without_progress: int = 2


class ExecutionBudget:
    def __init__(self, state: ExecutionBudgetState | None = None, limits: ExecutionLimits | None = None):
        self.state = state.model_copy(deep=True) if state else ExecutionBudgetState()
        self.limits = limits or ExecutionLimits()
        self._last_tick = monotonic()

    def tick(self) -> None:
        now = monotonic()
        self.state.active_seconds += max(0, now - self._last_tick)
        self._last_tick = now

    def stop_reason(self) -> str:
        self.tick()
        if self.state.finalization_reason:
            return self.state.finalization_reason
        if self.state.active_seconds >= self.limits.max_active_seconds:
            return "execution_time_budget"
        if self.state.tool_calls >= self.limits.max_tool_calls:
            return "tool_call_budget"
        if self.state.web_search_calls >= self.limits.max_web_search_calls:
            return "web_search_budget"
        if self.state.searches_without_progress >= self.limits.max_searches_without_progress:
            return "web_search_no_progress"
        return ""

    def record_call(self, name: str) -> None:
        self.state.tool_calls += 1
        if name == "search_public_web":
            self.state.web_search_calls += 1

    def record_result(self, name: str, result: ToolResult) -> None:
        if name != "search_public_web" or result.status != "done":
            return
        # A changed excerpt on an existing URL can fill a real evidence gap.
        # Mere URL counts and successful HTTP responses do not prove progress.
        fresh = False
        for source in [*result.data.get("sources", []), *result.data.get("evidence", [])]:
            if not isinstance(source, dict) or not isinstance(source.get("url"), str):
                continue
            excerpt = str(source.get("excerpt") or source.get("snippet") or source.get("content") or "")
            excerpt = " ".join(excerpt.split())[:2000]
            url = canonical_url(source["url"])
            if not excerpt:
                continue
            digest = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()
            seen = self.state.web_evidence.setdefault(url, [])
            if digest not in seen:
                fresh = True
                seen.append(digest)
        self.state.searches_without_progress = 0 if fresh else self.state.searches_without_progress + 1

    @classmethod
    def restore(cls, state: ExecutionBudgetState | None, messages: list[AgentMessage], limits: ExecutionLimits):
        budget = cls(state, limits)
        if state is None:
            # Old checkpoints have no counters; charge their already executed
            # operations rather than granting a fresh budget after resuming.
            for message in messages:
                payload = message.payload
                name = payload.get("tool_name")
                if message.role != "tool" or not name or payload.get("replayed") or payload.get("status") not in {"done", "failed"}:
                    continue
                budget.record_call(name)
                budget.record_result(name, ToolResult(ok=payload["status"] == "done", status=payload["status"], message=message.content, data=payload))
        return budget

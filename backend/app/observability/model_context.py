"""Per-call identity, propagated through async tasks without prompt content."""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator
from uuid import uuid4


_model_call: ContextVar[dict[str, Any]] = ContextVar("model_call", default={})
_PUBLIC_SELECTION_FIELDS = frozenset({
    "profile_id", "connection_id", "profile_revision", "connection_revision",
    "model_name", "model_base_url", "model_protocol", "resolved_model_protocol",
    "stage", "policy_version", "selection_reason", "capability_status",
    # Set when a LiteLLM router fallback model answered part of the run.
    "fallback_used", "answered_profile_id", "answered_model_name",
})


def public_model_selection(selection: dict[str, Any] | None) -> dict[str, Any]:
    if not selection:
        return {}
    result = {key: value for key, value in selection.items() if key in _PUBLIC_SELECTION_FIELDS}
    stages = selection.get("stage_selections")
    if isinstance(stages, dict):
        result["stage_selections"] = {
            key: public_model_selection(value) for key, value in stages.items() if isinstance(value, dict)
        }
    return result


@contextmanager
def model_call_scope(
    model_selection: dict[str, Any] | None,
    run_id: str = "",
    stage: str = "execute",
    selection_reason: str = "",
) -> Iterator[dict[str, Any]]:
    selection = model_selection or {}
    metadata = {
        "run_id": run_id,
        "call_id": str(uuid4()),
        "profile_id": str(selection.get("profile_id") or ""),
        "connection_id": str(selection.get("connection_id") or ""),
        "connection_revision": int(selection.get("connection_revision") or 0),
        "profile_revision": int(selection.get("profile_revision") or 0),
        "stage": stage,
        "selection_reason": selection_reason or str(selection.get("selection_reason") or ""),
    }
    token = _model_call.set(metadata)
    try:
        yield metadata
    finally:
        _model_call.reset(token)


def current_model_call() -> dict[str, Any]:
    return dict(_model_call.get())

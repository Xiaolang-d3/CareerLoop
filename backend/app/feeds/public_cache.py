"""Bounded process-local public snapshots, shared across account workers.

Only public source data and HTTP validators belong here. Account preferences,
bookmarks, model settings and AI output never enter this cache.
"""

from __future__ import annotations

import copy
import threading
from collections import OrderedDict
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Callable, Hashable


class NotModified(Exception):
    """A conditional GET matched a previously parsed public snapshot."""


@dataclass
class RequestState:
    url: str
    validators: dict[str, str] = field(default_factory=dict)
    response_validators: dict[str, str] = field(default_factory=dict)


request_state: ContextVar[RequestState | None] = ContextVar("public_feed_request", default=None)


@dataclass
class Snapshot:
    items: list[dict[str, Any]]
    fetched_at: float
    checked_at: float


@dataclass
class _Entry:
    lock: Any = field(default_factory=threading.Lock)
    users: int = 0
    snapshot: Snapshot | None = None
    validators: dict[str, str] = field(default_factory=dict)


class PublicSourceCache:
    def __init__(self, max_entries: int = 128):
        self.max_entries = max_entries
        self._entries: OrderedDict[Hashable, _Entry] = OrderedDict()
        self._guard = threading.Lock()

    def get(self, key: Hashable, *, url: str, ttl: int, now: Callable[[], float],
            load: Callable[[], list[dict[str, Any]]], force: bool = False) -> Snapshot:
        with self._guard:
            entry = self._entries.get(key)
            if entry is None:
                if len(self._entries) >= self.max_entries:
                    victim = next((k for k, value in self._entries.items() if not value.users), None)
                    if victim is not None:
                        del self._entries[victim]
                entry = _Entry()
                # All slots busy: fetch uncached instead of growing without bound.
                if len(self._entries) < self.max_entries:
                    self._entries[key] = entry
            else:
                self._entries.move_to_end(key)
            entry.users += 1
            observed = entry.snapshot
        try:
            with entry.lock:
                previous = entry.snapshot
                age = now() - previous.checked_at if previous else float("inf")
                # Concurrent force requests share the in-flight result. Sequential
                # manual refreshes still honour a 30-second public-source cooldown.
                if previous and 0 <= age < (30 if force else ttl):
                    return copy.deepcopy(previous)
                if previous and previous is not observed:
                    return copy.deepcopy(previous)
                state = RequestState(url, dict(entry.validators) if previous else {})
                token = request_state.set(state)
                try:
                    try:
                        items = load()
                        checked = now()
                        result = Snapshot(items, checked, checked)
                        validators = state.response_validators
                    except NotModified:
                        if previous is None:
                            raise ValueError("来源返回 304 但没有可复用内容") from None
                        result = Snapshot(previous.items, previous.fetched_at, now())
                        validators = {**entry.validators, **state.response_validators}
                    # Commit validators only after parsing succeeds. A bad 200
                    # must not bind a new ETag to the old, valid article snapshot.
                    entry.snapshot = copy.deepcopy(result)
                    entry.validators = dict(validators)
                    return copy.deepcopy(result)
                finally:
                    request_state.reset(token)
        finally:
            with self._guard:
                entry.users -= 1

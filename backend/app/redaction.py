"""Remove credentials from text that may reach users, logs or the database.

Upstream gateways sometimes echo the Authorization header or API key back in
error bodies; those bodies end up in ModelProviderError messages and in
``model_service_events.error_message``.
"""
from __future__ import annotations

import re
from collections.abc import Iterable

MASK = "***"
_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=\-]{4,}"), r"\1 " + MASK),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{6,}"), "sk-" + MASK),
    (re.compile(r"\bAIza[0-9A-Za-z_\-]{20,}"), "AIza" + MASK),
    (
        re.compile(r"""(?i)\b((?:x-)?(?:goog-)?api[_-]?key|access[_-]?token|authorization|secret)(["']?\s*[:=]\s*["']?)(?!Bearer\b|Basic\b)[^\s"'&,;}\]]{4,}"""),
        r"\1\2" + MASK,
    ),
    (re.compile(r"(?i)([?&]key=)[^&\s\"']+"), r"\1" + MASK),
)
_MIN_SECRET_LENGTH = 4


def redact_secrets(text: str, secrets: Iterable[str | None] = ()) -> str:
    """Mask the given secrets verbatim, then common credential shapes."""
    if not text:
        return text
    for secret in sorted({item for item in secrets if item and len(item) >= _MIN_SECRET_LENGTH}, key=len, reverse=True):
        text = text.replace(secret, MASK)
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text

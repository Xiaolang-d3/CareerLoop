"""Offline password creation policy shared with the browser."""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path

_POLICY = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))
PASSWORD_MIN_LENGTH: int = _POLICY["minLength"]
PASSWORD_MAX_LENGTH: int = _POLICY["maxLength"]
LEGACY_PASSWORD_MAX_LENGTH: int = _POLICY["legacyMaxLength"]
_BLOCKLIST = frozenset(_POLICY["blocklist"])


def normalize_password(password: str) -> str:
    return unicodedata.normalize("NFC", password)


def password_error(password: str, email: str = "") -> str | None:
    normalized = normalize_password(password)
    if len(normalized) < PASSWORD_MIN_LENGTH:
        return f"密码至少需要 {PASSWORD_MIN_LENGTH} 个字符"
    if len(normalized) > PASSWORD_MAX_LENGTH:
        return f"密码不能超过 {PASSWORD_MAX_LENGTH} 个字符"
    identity = normalize_password(email.strip()).lower()
    if normalized.lower() in _BLOCKLIST or normalized.lower() in {identity, identity.partition("@")[0]}:
        return _POLICY["weakMessage"]
    return None

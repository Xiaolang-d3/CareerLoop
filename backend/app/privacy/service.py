from __future__ import annotations

import re
from dataclasses import asdict, dataclass


@dataclass
class PrivacyFinding:
    entity_type: str
    start: int
    end: int
    score: float
    preview: str


_PRIVACY_PATTERNS = (
    (
        "EMAIL_ADDRESS",
        re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
        0.95,
    ),
    (
        "PHONE_NUMBER",
        re.compile(r"(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)"),
        0.9,
    ),
    (
        "CN_ID_CARD",
        re.compile(
            r"(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])"
            r"(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?!\d)"
        ),
        0.95,
    ),
)
_REDACTION_LABELS = {
    "EMAIL_ADDRESS": "[邮箱已隐藏]",
    "PHONE_NUMBER": "[手机号已隐藏]",
    "CN_ID_CARD": "[身份证号已隐藏]",
}


def scan_and_redact(text: str) -> tuple[list[dict], str]:
    """Detect common personal identifiers locally without loading an NLP/cloud model."""
    if not text:
        return [], text
    findings: list[dict] = []
    for entity_type, pattern, score in _PRIVACY_PATTERNS:
        for match in pattern.finditer(text):
            findings.append(asdict(PrivacyFinding(
                entity_type,
                match.start(),
                match.end(),
                score,
                _safe_preview(match.group(0)),
            )))
    findings.sort(key=lambda item: (item["start"], item["end"]))

    redacted = text
    for finding in reversed(findings):
        redacted = (
            redacted[:finding["start"]]
            + _REDACTION_LABELS[finding["entity_type"]]
            + redacted[finding["end"]:]
        )
    return findings, redacted


def _safe_preview(value: str) -> str:
    if "@" in value:
        left, _, right = value.partition("@")
        return f"{left[:1]}***@{right}"
    if len(value) <= 5:
        return "***"
    return f"{value[:3]}***{value[-2:]}"

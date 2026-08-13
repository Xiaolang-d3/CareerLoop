from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass
class PrivacyFinding:
    entity_type: str
    start: int
    end: int
    score: float
    preview: str


def scan_and_redact(text: str) -> tuple[list[dict], str]:
    """Detect common resume PII locally without loading an NLP/cloud model."""
    if not text:
        return [], text

    from presidio_analyzer import Pattern, PatternRecognizer
    from presidio_anonymizer import AnonymizerEngine
    from presidio_anonymizer.entities import OperatorConfig

    definitions = (
        ("EMAIL_ADDRESS", r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", 0.95),
        ("PHONE_NUMBER", r"(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)", 0.9),
        ("CN_ID_CARD", r"(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?!\d)", 0.95),
    )
    results = []
    for entity_type, expression, score in definitions:
        recognizer = PatternRecognizer(
            supported_entity=entity_type,
            supported_language="zh",
            patterns=[Pattern(entity_type.lower(), expression, score)],
        )
        results.extend(recognizer.analyze(text, [entity_type]))
    results.sort(key=lambda item: (item.start, item.end))

    findings = [
        asdict(
            PrivacyFinding(
                result.entity_type,
                result.start,
                result.end,
                round(float(result.score), 2),
                _safe_preview(text[result.start : result.end]),
            )
        )
        for result in results
    ]
    operators = {
        "EMAIL_ADDRESS": OperatorConfig("replace", {"new_value": "[邮箱已隐藏]"}),
        "PHONE_NUMBER": OperatorConfig("replace", {"new_value": "[手机号已隐藏]"}),
        "CN_ID_CARD": OperatorConfig("replace", {"new_value": "[身份证号已隐藏]"}),
    }
    redacted = AnonymizerEngine().anonymize(text=text, analyzer_results=results, operators=operators).text
    return findings, redacted


def _safe_preview(value: str) -> str:
    if "@" in value:
        left, _, right = value.partition("@")
        return f"{left[:1]}***@{right}"
    if len(value) <= 5:
        return "***"
    return f"{value[:3]}***{value[-2:]}"

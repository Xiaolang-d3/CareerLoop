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
    """Detect common resume PII locally without loading an NLP/cloud model."""
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


_EMPTY_CONTACT_LABEL = re.compile(
    r"(?i)(?:电话|手机|邮箱|邮件|身份证(?:号码|号)?|联系方式)\s*[:：]\s*"
)
_LABELED_PERSONAL_LINE = re.compile(
    r"(?i)^\s*(?:姓名|性别|年龄|出生(?:日期|年月)?|微信(?:号)?|QQ|地址|住址|籍贯|民族|婚姻状况)\s*[:：]"
)
_INLINE_PERSONAL_FIELD = re.compile(
    r"(?i)(?:微信(?:号)?|QQ|地址|住址)\s*[:：]\s*[^\s|｜,，;；]+"
)
_LIKELY_RESUME_HEADING_OR_NAME = re.compile(r"^[\u3400-\u9fff·]{2,4}$")
_RESUME_SECTION_HEADINGS = {
    "个人优势", "个人简介", "求职方向", "求职意向", "教育经历", "工作经历",
    "实习经历", "项目经历", "技能清单", "专业技能", "获奖经历", "证书资质",
}


def strip_resume_personal_info(text: str) -> tuple[list[dict], str]:
    """Remove detected contact identifiers from resume text before storage.

    Unlike ``scan_and_redact``, resume import should not retain placeholders such
    as ``[邮箱已隐藏]``. Removing findings by their original spans preserves other
    content on a mixed line, for example the target role before a phone number.
    """
    findings, _ = scan_and_redact(text)
    clean = text
    for finding in reversed(findings):
        start = int(finding["start"])
        end = int(finding["end"])
        clean = clean[:start] + clean[end:]

    lines: list[str] = []
    first_content_line = True
    for raw in clean.splitlines():
        if _LABELED_PERSONAL_LINE.match(raw):
            continue
        line = _EMPTY_CONTACT_LABEL.sub("", raw)
        line = _INLINE_PERSONAL_FIELD.sub("", line)
        line = re.sub(r"[ \t]{2,}", " ", line).strip(" \t|｜,，;；")
        if (
            first_content_line
            and line not in _RESUME_SECTION_HEADINGS
            and _LIKELY_RESUME_HEADING_OR_NAME.fullmatch(line)
        ):
            first_content_line = False
            continue
        if line:
            first_content_line = False
            lines.append(line)
        elif lines and lines[-1] != "":
            lines.append("")
    while lines and not lines[-1]:
        lines.pop()
    return findings, "\n".join(lines)


def _safe_preview(value: str) -> str:
    if "@" in value:
        left, _, right = value.partition("@")
        return f"{left[:1]}***@{right}"
    if len(value) <= 5:
        return "***"
    return f"{value[:3]}***{value[-2:]}"

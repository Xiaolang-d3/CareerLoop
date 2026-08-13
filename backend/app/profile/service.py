from __future__ import annotations

from pathlib import Path
from typing import Any

from ..privacy import scan_and_redact
from .intelligence import extract_skills, suggest_profile_fields
from ..resume.parser import parse_resume_result


def parse_candidate_resume(
    filename: str,
    content: bytes,
    mode: str,
) -> dict[str, Any]:
    suffix = Path(filename).suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        from ..jobs.screenshot_ocr import extract_screenshot_text

        text = extract_screenshot_text(filename, content)
        parser = "local_ocr"
        warnings = ["截图 OCR 结果可能受清晰度和裁剪范围影响，请保存前检查文本。"]
    else:
        parsed = parse_resume_result(filename, content, mode)
        text = parsed.text
        parser = parsed.parser
        warnings = parsed.warnings
    findings, redacted_text = scan_and_redact(text)
    return {
        "filename": filename[:255],
        "text": text,
        "redacted_text": redacted_text,
        "privacy_findings": findings,
        "suggested_skills": extract_skills(text),
        "suggested_profile": suggest_profile_fields(text),
        "character_count": len(text),
        "parser": parser,
        "warnings": warnings,
        "notice": "仅完成本地文本提取；确认保存前不会写入人物画像。",
    }


def scan_candidate_privacy(text: str) -> dict[str, Any]:
    findings, redacted_text = scan_and_redact(text)
    return {
        "findings": findings,
        "redacted_text": redacted_text,
        "notice": "检测在本机完成；结果用于提醒，保存和是否向 Agent 提供原文仍由你决定。",
    }

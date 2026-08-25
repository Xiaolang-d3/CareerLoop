from __future__ import annotations

from pathlib import Path
from typing import Any

from ..privacy import scan_and_redact, strip_resume_personal_info
from .intelligence import extract_skill_tags, suggest_profile_fields
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
    findings, safe_text = strip_resume_personal_info(text)
    return {
        "filename": filename[:255],
        "text": safe_text,
        "redacted_text": safe_text,
        "privacy_findings": findings,
        "suggested_skills": extract_skill_tags(safe_text),
        "suggested_profile": suggest_profile_fields(safe_text),
        "character_count": len(safe_text),
        "parser": parser,
        "warnings": warnings,
        "notice": "仅完成本地文本提取；姓名、联系方式和证件信息已移除，确认保存前不会写入人物画像。",
    }


def scan_candidate_privacy(text: str) -> dict[str, Any]:
    findings, redacted_text = scan_and_redact(text)
    return {
        "findings": findings,
        "redacted_text": redacted_text,
        "notice": "检测在本机完成；结果用于提醒，保存和是否向 Agent 提供原文仍由你决定。",
    }

from __future__ import annotations

import re
from datetime import UTC, datetime
from html import unescape
from typing import Any
from urllib.parse import urlparse, urlunparse

from ..research.web import is_public_source_url


MAX_DESCRIPTION_CHARS = 50_000


class JobImportError(ValueError):
    pass


def stable_job_source_url(value: str) -> str:
    """Return a reusable source URL without BOSS detail-page session tokens."""
    candidate = value.strip()
    parsed = urlparse(candidate)
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return candidate
    if (
        (hostname == "zhipin.com" or hostname.endswith(".zhipin.com"))
        and "/job_detail/" in parsed.path.lower()
    ):
        path = parsed.path.rstrip("/") or "/"
        return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))
    return candidate


def validate_job_import_url(value: str) -> str:
    candidate = value.strip()
    if not candidate:
        raise JobImportError("请粘贴岗位页面链接")
    parsed = urlparse(candidate)
    if parsed.scheme != "https":
        raise JobImportError("为保护本地数据，岗位链接只允许使用 HTTPS")
    if parsed.username or parsed.password:
        raise JobImportError("岗位链接不能包含账号或密码")
    try:
        port = parsed.port
    except ValueError as exc:
        raise JobImportError("岗位链接端口不合法") from exc
    if port not in {None, 443}:
        raise JobImportError("岗位链接只允许使用标准 HTTPS 端口")
    if not is_public_source_url(candidate):
        raise JobImportError("岗位链接必须指向公开互联网地址")
    return candidate


def preview_job_text(
    text: str,
    *,
    source_url: str = "",
) -> dict[str, Any]:
    """Create a structured preview from user-pasted job text."""
    normalized_text = _normalize_import_text(text)
    if not normalized_text:
        raise JobImportError("请粘贴岗位 JD 或岗位页面中可见的文字")
    if len(normalized_text) > MAX_DESCRIPTION_CHARS:
        raise JobImportError("粘贴的岗位文字超过 50,000 字符")

    stable_source = ""
    if source_url.strip():
        stable_source = stable_job_source_url(validate_job_import_url(source_url))
    source_domain = urlparse(stable_source).hostname or ""
    lines = [line for line in normalized_text.splitlines() if line]
    job_title = _extract_labeled_value(
        normalized_text,
        ("岗位名称", "职位名称", "职位"),
    )
    if not job_title:
        job_title = _guess_job_title(lines)
    company_name = _extract_labeled_value(
        normalized_text,
        ("公司名称", "招聘公司", "所属公司", "公司"),
    )
    location = _extract_labeled_value(
        normalized_text,
        ("工作地点", "职位地点", "办公地点", "地点"),
    )
    salary_text = _extract_salary(normalized_text[:3_000])
    description = _extract_job_description(normalized_text, "") or normalized_text
    description = description[:MAX_DESCRIPTION_CHARS].strip()

    warnings: list[str] = []
    if not job_title:
        warnings.append("粘贴文字中未能可靠识别岗位名称，请在保存前补充。")
    if not company_name:
        warnings.append("粘贴文字中未能可靠识别公司名称，请在保存前补充。")
    status = "ready" if len(description) >= 40 else "partial"
    if status == "partial":
        warnings.append("粘贴文字较少，请补充完整 JD 后再开始分析。")
    platform = "boss" if "zhipin.com" in source_domain else "generic"
    return {
        "status": status,
        "source_url": stable_source,
        "final_url": stable_source,
        "source_domain": source_domain,
        "job_title": job_title[:200],
        "company_name": company_name[:200],
        "location": location[:200],
        "salary_text": salary_text[:100],
        "description": description,
        "extraction_method": "manual_text",
        "character_count": len(description),
        "fetched_at": datetime.now(UTC).isoformat(),
        "warnings": warnings,
        "page_type": "job_detail",
        "confidence": 0.82 if status == "ready" else 0.55,
        "assessment_reason": "岗位内容来自用户粘贴的可见文字，保存前需要人工确认。",
        "assessment_evidence": ["用户粘贴岗位文字", f"提取 {len(description)} 个字符"],
        "decision_source": "parser",
        "stop_reason": "" if status == "ready" else "粘贴内容不足，等待补充岗位 JD。",
        "platform": platform,
        "requested_page_type": "job_detail",
        "fetch_page_type": "job_detail",
        "agent_rounds": 0,
        "agent_trace": [],
    }


def preview_job_screenshot(
    filename: str,
    content: bytes,
    *,
    source_url: str = "",
) -> dict[str, Any]:
    """Build an ephemeral job preview from locally OCRed screenshot text."""
    from .screenshot_ocr import extract_screenshot_text

    text = extract_screenshot_text(filename, content)
    stable_source = stable_job_source_url(source_url) if source_url.strip() else ""
    source_domain = urlparse(stable_source).hostname or ""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    job_title = _extract_labeled_value(text, ("岗位名称", "职位名称", "职位"))
    if not job_title:
        job_title = _guess_job_title(lines)
    company_name = _extract_labeled_value(
        text,
        ("公司名称", "招聘公司", "所属公司"),
    )
    location = _extract_labeled_value(
        text,
        ("工作地点", "职位地点", "办公地点"),
    )
    salary_text = _extract_salary(text[:3000])
    description = _extract_job_description(text, "") or text
    warnings: list[str] = []
    if not job_title:
        warnings.append("截图中未能可靠识别岗位名称，请在保存前补充。")
    if not company_name:
        warnings.append("截图中未能可靠识别公司名称，请在保存前补充。")
    status = "ready" if len(description) >= 40 else "partial"
    if status == "partial":
        warnings.append("截图文字较少，请补充完整 JD 后再开始分析。")
    platform = "boss" if "zhipin.com" in source_domain else "generic"
    return {
        "status": status,
        "source_url": stable_source,
        "final_url": stable_source,
        "source_domain": source_domain,
        "job_title": job_title[:200],
        "company_name": company_name[:200],
        "location": location[:200],
        "salary_text": salary_text[:100],
        "description": description[:MAX_DESCRIPTION_CHARS].strip(),
        "extraction_method": "ocr",
        "character_count": len(description),
        "fetched_at": datetime.now(UTC).isoformat(),
        "warnings": warnings,
        "page_type": "job_detail",
        "confidence": 0.78 if status == "ready" else 0.55,
        "assessment_reason": "岗位内容来自用户上传截图的本地 OCR，保存前需要人工确认。",
        "assessment_evidence": ["用户上传岗位截图", f"本地 OCR 提取 {len(description)} 个字符"],
        "decision_source": "parser",
        "stop_reason": "" if status == "ready" else "截图内容不足，等待补充岗位 JD。",
        "platform": platform,
        "requested_page_type": "job_detail",
        "fetch_page_type": "job_detail",
        "agent_rounds": 0,
        "agent_trace": [],
    }


def _normalize_import_text(value: str) -> str:
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
    lines = [" ".join(line.split()) for line in cleaned.replace("\r\n", "\n").replace("\r", "\n").splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _guess_job_title(lines: list[str]) -> str:
    excluded_markers = (
        "职位描述",
        "岗位职责",
        "工作职责",
        "任职要求",
        "岗位要求",
        "公司名称",
        "招聘公司",
        "工作地点",
        "职位地点",
        "办公地点",
        "薪资",
        "福利",
    )
    for line in lines[:10]:
        if not 2 <= len(line) <= 80:
            continue
        if any(marker in line for marker in excluded_markers):
            continue
        if re.match(r"^(岗位|职位|公司|地点|薪资|经验|学历|工作年限)\s*[：:]", line):
            continue
        return line
    return ""


def _extract_labeled_value(text: str, labels: tuple[str, ...]) -> str:
    for label in labels:
        match = re.search(rf"{re.escape(label)}\s*[：:]\s*([^\n]{{1,120}})", text)
        if match:
            return _compact_text(match.group(1))
    return ""


def _extract_salary(text: str) -> str:
    match = re.search(
        r"(?<!\d)(\d{1,3}(?:\.\d+)?\s*[-~—–至]\s*\d{1,3}(?:\.\d+)?\s*[Kk千万元]?)(?:[·・]\s*\d{1,2}薪)?",
        text,
    )
    return _compact_text(match.group(0)) if match else ""


def _extract_job_description(visible_text: str, metadata_description: str) -> str:
    lines = [line.strip() for line in visible_text.splitlines() if line.strip()]
    start_markers = ("职位描述", "岗位职责", "工作职责", "任职要求", "岗位要求")
    stop_markers = ("公司介绍", "工商信息", "相关推荐", "相似职位", "安全提示")
    start = next(
        (index for index, line in enumerate(lines) if any(marker in line for marker in start_markers)),
        None,
    )
    if start is not None:
        selected: list[str] = []
        for line in lines[start : start + 220]:
            if selected and any(marker in line for marker in stop_markers):
                break
            if line not in selected:
                selected.append(line)
        description = "\n".join(selected)
        if len(description) >= 40:
            return description
    fallback = _html_to_text(metadata_description)
    return fallback if len(fallback) >= 40 else ""


def _html_to_text(value: str) -> str:
    text = re.sub(r"<\s*br\s*/?\s*>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"</\s*(?:p|div|li|h[1-6])\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    lines = [_compact_text(line) for line in unescape(text).splitlines()]
    return "\n".join(line for line in lines if line)


def _compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(value or "")).strip()

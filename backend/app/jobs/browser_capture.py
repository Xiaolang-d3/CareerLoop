from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from html import escape
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from .imports import JobImportError, validate_job_import_url


CAPTURE_MAX_AGE = timedelta(minutes=5)
CAPTURE_FUTURE_TOLERANCE = timedelta(seconds=30)
TRACKING_QUERY_KEYS = {
    "securityid",
    "ka",
    "lid",
    "sessionid",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
}


class BrowserCaptureError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        page_type: str = "unknown",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.page_type = page_type


def canonical_job_url(value: str) -> str:
    parsed = urlparse(value.strip())
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return ""
    port = f":{parsed.port}" if parsed.port and parsed.port != 443 else ""
    netloc = hostname + port
    path = parsed.path.rstrip("/") or "/"
    query_pairs = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in TRACKING_QUERY_KEYS
    ]
    if hostname == "zhipin.com" or hostname.endswith(".zhipin.com"):
        if "/job_detail/" in path.lower():
            query_pairs = []
    return urlunparse(
        (
            parsed.scheme.lower(),
            netloc,
            path,
            "",
            urlencode(sorted(query_pairs)),
            "",
        )
    )


def validate_browser_job_capture(payload: dict[str, Any]) -> dict[str, Any]:
    requested_url = _validated_url(str(payload.get("requested_url") or ""))
    final_url = _validated_url(str(payload.get("final_url") or ""))
    if canonical_job_url(requested_url) != canonical_job_url(final_url):
        raise BrowserCaptureError(
            "page_mismatch",
            "浏览器页面与提交的岗位链接不一致",
        )

    captured_at = _parse_captured_at(str(payload.get("captured_at") or ""))
    now = datetime.now(UTC)
    if captured_at < now - CAPTURE_MAX_AGE:
        raise BrowserCaptureError("capture_expired", "浏览器页面读取结果已过期")
    if captured_at > now + CAPTURE_FUTURE_TOLERANCE:
        raise BrowserCaptureError("capture_invalid_time", "浏览器页面读取时间不合法")

    actual_platform = _platform_for_url(final_url)
    reported_platform = str(payload.get("platform") or "generic")
    if actual_platform != "boss":
        raise BrowserCaptureError("platform_unsupported", "当前版本仅支持 BOSS 直聘岗位页面")
    if reported_platform != "boss":
        raise BrowserCaptureError("platform_mismatch", "浏览器页面平台信息不一致")

    page_type = str(payload.get("page_type") or "unknown")
    blocked = {
        "login_required": ("login_required", "当前浏览器页面需要登录"),
        "captcha": ("security_challenge", "当前浏览器仍显示安全验证"),
        "job_expired": ("job_expired", "岗位已下架或链接已失效"),
        "empty_page": ("content_incomplete", "页面没有可读取的岗位内容"),
        "unknown": ("content_incomplete", "无法确认当前页面是岗位详情"),
    }
    if page_type in blocked:
        code, message = blocked[page_type]
        raise BrowserCaptureError(code, message, page_type=page_type)
    if page_type != "job_detail":
        raise BrowserCaptureError(
            "content_incomplete",
            "当前页面不是可读取的岗位详情",
            page_type=page_type,
        )

    title = _clean_text(str(payload.get("title") or ""), limit=500)
    visible_text = _clean_multiline(
        str(payload.get("visible_text") or ""),
        limit=50_000,
    )
    raw_hints = payload.get("hints")
    hints = raw_hints if isinstance(raw_hints, dict) else {}
    normalized_hints = {
        "job_title": _clean_text(str(hints.get("job_title") or ""), limit=500),
        "company_name": _clean_text(str(hints.get("company_name") or ""), limit=500),
        "location": _clean_text(str(hints.get("location") or ""), limit=500),
        "salary_text": _clean_text(str(hints.get("salary_text") or ""), limit=200),
        "description": _clean_multiline(
            str(hints.get("description") or ""),
            limit=50_000,
        ),
    }
    if not normalized_hints["job_title"] and not title:
        raise BrowserCaptureError("content_incomplete", "页面没有岗位名称")
    description = normalized_hints["description"] or visible_text
    if len(description) < 40:
        raise BrowserCaptureError("content_incomplete", "页面没有完整岗位描述")

    return {
        "capture_id": str(payload.get("capture_id") or ""),
        "requested_url": requested_url,
        "final_url": final_url,
        "platform": actual_platform,
        "page_type": "job_detail",
        "title": title,
        "visible_text": visible_text,
        "hints": normalized_hints,
        "captured_at": captured_at.isoformat(),
        "truncated": bool(payload.get("truncated")),
        "html": _capture_html(
            title=title,
            visible_text=visible_text,
            hints=normalized_hints,
        ),
    }


def _capture_html(
    *,
    title: str,
    visible_text: str,
    hints: dict[str, str],
) -> str:
    job_title = hints["job_title"] or title
    description = hints["description"] or visible_text
    facts = "\n".join(
        (
            f"公司名称：{hints['company_name']}",
            f"工作地点：{hints['location']}",
            f"薪资：{hints['salary_text']}",
        )
    )
    return (
        "<html><head><title>"
        + escape(job_title)
        + "</title></head><body><main><h1>"
        + escape(job_title)
        + "</h1><div>"
        + escape(facts).replace("\n", "<br>")
        + "</div><h2>职位描述</h2><div>"
        + escape(description).replace("\n", "<br>")
        + "</div></main></body></html>"
    )


def _validated_url(value: str) -> str:
    try:
        return validate_job_import_url(value)
    except JobImportError as exc:
        raise BrowserCaptureError("invalid_url", str(exc)) from exc


def _parse_captured_at(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BrowserCaptureError(
            "capture_invalid_time",
            "浏览器页面读取时间不合法",
        ) from exc
    if parsed.tzinfo is None:
        raise BrowserCaptureError(
            "capture_invalid_time",
            "浏览器页面读取时间必须包含时区",
        )
    return parsed.astimezone(UTC)


def _platform_for_url(value: str) -> str:
    hostname = (urlparse(value).hostname or "").lower()
    if hostname == "zhipin.com" or hostname.endswith(".zhipin.com"):
        return "boss"
    return "generic"


def _clean_text(value: str, *, limit: int) -> str:
    return " ".join(_strip_controls(value).split())[:limit]


def _clean_multiline(value: str, *, limit: int) -> str:
    cleaned = _strip_controls(value).replace("\r\n", "\n").replace("\r", "\n")
    lines = [" ".join(line.split()) for line in cleaned.splitlines()]
    return "\n".join(line for line in lines if line)[:limit]


def _strip_controls(value: str) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)

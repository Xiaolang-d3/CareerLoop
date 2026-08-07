from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from html import unescape
from html.parser import HTMLParser
from http.client import RemoteDisconnected
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .web_research import is_public_source_url


MAX_PAGE_BYTES = 2_000_000
MAX_DESCRIPTION_CHARS = 50_000
MAX_REDIRECTS = 3


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


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(
        self,
        req: Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> None:
        return None


class _JobPageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.page_title = ""
        self.meta: dict[str, str] = {}
        self.json_ld: list[str] = []
        self.visible_text: list[str] = []
        self._title_parts: list[str] = []
        self._json_ld_parts: list[str] | None = None
        self._hidden_depth = 0

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        attrs_map = {key.lower(): value or "" for key, value in attrs}
        lowered = tag.lower()
        if lowered == "meta":
            key = (attrs_map.get("property") or attrs_map.get("name") or "").lower()
            content = attrs_map.get("content", "").strip()
            if key and content:
                self.meta[key] = content
        if lowered == "title":
            self._title_parts = []
        if lowered == "script" and attrs_map.get("type", "").lower() == "application/ld+json":
            self._json_ld_parts = []
            return
        if lowered in {"script", "style", "noscript", "svg", "canvas"}:
            self._hidden_depth += 1

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered == "title":
            self.page_title = _compact_text(" ".join(self._title_parts))[:500]
        if lowered == "script" and self._json_ld_parts is not None:
            payload = "".join(self._json_ld_parts).strip()
            if payload:
                self.json_ld.append(payload)
            self._json_ld_parts = None
            return
        if lowered in {"script", "style", "noscript", "svg", "canvas"}:
            self._hidden_depth = max(0, self._hidden_depth - 1)

    def handle_data(self, data: str) -> None:
        if self._json_ld_parts is not None:
            self._json_ld_parts.append(data)
            return
        if self._title_parts is not None and not self.page_title:
            self._title_parts.append(data)
        if self._hidden_depth:
            return
        text = _compact_text(data)
        if text:
            self.visible_text.append(text)


def preview_job_url(
    url: str,
    *,
    agent: Any | None = None,
) -> dict[str, Any]:
    if agent is None:
        from .job_import_agent import JobImportAgent

        agent = JobImportAgent()
    return agent.run(url)


def page_context(html: str) -> dict[str, str]:
    parser = _JobPageParser()
    parser.feed(html[:MAX_PAGE_BYTES])
    return {
        "title": (
            parser.meta.get("og:title")
            or parser.meta.get("twitter:title")
            or parser.page_title
        ),
        "metadata_description": (
            parser.meta.get("og:description")
            or parser.meta.get("description")
            or ""
        ),
        "visible_text": "\n".join(parser.visible_text),
    }


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


def parse_job_page(
    html: str,
    *,
    source_url: str,
    final_url: str | None = None,
) -> dict[str, Any]:
    parser = _JobPageParser()
    parser.feed(html[:MAX_PAGE_BYTES])
    job_posting = _find_job_posting(parser.json_ld)
    visible_text = "\n".join(parser.visible_text)
    metadata_title = (
        parser.meta.get("og:title")
        or parser.meta.get("twitter:title")
        or parser.page_title
    )
    metadata_description = (
        parser.meta.get("og:description")
        or parser.meta.get("description")
        or ""
    )

    job_title = _compact_text(str(job_posting.get("title") or ""))
    company_name = _organization_name(job_posting.get("hiringOrganization"))
    location = _format_location(job_posting.get("jobLocation"))
    salary_text = _format_salary(job_posting.get("baseSalary"))
    description = _html_to_text(str(job_posting.get("description") or ""))
    extraction_method = "json_ld"

    if not job_title:
        job_title = _clean_page_title(metadata_title)
    if not company_name:
        company_name = _extract_labeled_value(
            visible_text,
            ("公司名称", "招聘公司", "所属公司"),
        )
    if not location:
        location = _extract_labeled_value(
            visible_text,
            ("工作地点", "职位地点", "办公地点"),
        )
    if not salary_text:
        salary_text = _extract_salary(f"{metadata_title}\n{metadata_description}\n{visible_text[:3000]}")
    if not description:
        description = _extract_job_description(visible_text, metadata_description)
        extraction_method = "page_text"

    description = description[:MAX_DESCRIPTION_CHARS].strip()
    return {
        "status": "ready",
        "source_url": stable_job_source_url(source_url),
        "final_url": stable_job_source_url(final_url or source_url),
        "source_domain": urlparse(stable_job_source_url(final_url or source_url)).hostname or "",
        "job_title": job_title[:200],
        "company_name": company_name[:200],
        "location": location[:200],
        "salary_text": salary_text[:100],
        "description": description,
        "extraction_method": extraction_method,
        "character_count": len(description),
        "fetched_at": datetime.now(UTC).isoformat(),
        "warnings": [],
        "page_type": "unknown",
        "confidence": 0,
        "assessment_reason": "",
        "assessment_evidence": [],
        "decision_source": "parser",
        "stop_reason": "",
    }


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


def _fetch_public_page(url: str) -> tuple[str, str]:
    opener = build_opener(ProxyHandler({}), _NoRedirectHandler())
    current_url = url
    for redirect_count in range(MAX_REDIRECTS + 1):
        request = Request(
            current_url,
            headers={
                "Accept": "text/html,text/plain;q=0.9",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
                "User-Agent": "BossCopilot-LinkImporter/0.1",
            },
        )
        try:
            with opener.open(request, timeout=12) as response:
                content_type = response.headers.get_content_type()
                if content_type not in {"text/html", "text/plain", "application/xhtml+xml"}:
                    raise JobImportError("该链接不是可解析的网页，请改用截图或PDF导入")
                body = response.read(MAX_PAGE_BYTES + 1)
                if len(body) > MAX_PAGE_BYTES:
                    raise JobImportError("岗位页面内容超过大小限制")
                charset = response.headers.get_content_charset() or "utf-8"
                try:
                    text = body.decode(charset)
                except (LookupError, UnicodeDecodeError):
                    text = body.decode("utf-8", errors="replace")
                return current_url, text
        except HTTPError as exc:
            if exc.code in {301, 302, 303, 307, 308}:
                location = exc.headers.get("Location")
                if not location or redirect_count >= MAX_REDIRECTS:
                    raise JobImportError("岗位链接重定向次数过多") from exc
                current_url = validate_job_import_url(urljoin(current_url, location))
                continue
            if exc.code in {401, 403}:
                raise JobImportError(
                    "该页面需要登录或拒绝公开访问，请上传截图或粘贴JD"
                ) from exc
            if exc.code == 404:
                raise JobImportError("岗位页面不存在或已经失效") from exc
            raise JobImportError(f"岗位页面读取失败（HTTP {exc.code}）") from exc
        except TimeoutError as exc:
            raise JobImportError("岗位页面读取超时，请稍后重试") from exc
        except (URLError, RemoteDisconnected, ConnectionError, OSError) as exc:
            raise JobImportError("当前无法读取该岗位页面，请检查网络或改用截图导入") from exc
    raise JobImportError("岗位链接重定向次数过多")


def _find_job_posting(chunks: list[str]) -> dict[str, Any]:
    def walk(value: Any) -> dict[str, Any] | None:
        if isinstance(value, dict):
            raw_type = value.get("@type")
            types = raw_type if isinstance(raw_type, list) else [raw_type]
            if any(str(item).lower() == "jobposting" for item in types):
                return value
            for nested in value.values():
                found = walk(nested)
                if found:
                    return found
        if isinstance(value, list):
            for nested in value:
                found = walk(nested)
                if found:
                    return found
        return None

    for chunk in chunks:
        try:
            payload = json.loads(chunk)
        except json.JSONDecodeError:
            continue
        found = walk(payload)
        if found:
            return found
    return {}


def _organization_name(value: Any) -> str:
    if isinstance(value, dict):
        return _compact_text(str(value.get("name") or ""))
    return _compact_text(str(value or ""))


def _format_location(value: Any) -> str:
    locations = value if isinstance(value, list) else [value]
    parts: list[str] = []
    for location in locations:
        if not isinstance(location, dict):
            continue
        address = location.get("address")
        if isinstance(address, dict):
            text = " ".join(
                str(address.get(key) or "").strip()
                for key in ("addressRegion", "addressLocality", "streetAddress")
            )
        else:
            text = str(address or location.get("name") or "")
        text = _compact_text(text)
        if text and text not in parts:
            parts.append(text)
    return "；".join(parts)


def _format_salary(value: Any) -> str:
    if isinstance(value, str):
        return _compact_text(value)
    if not isinstance(value, dict):
        return ""
    currency = str(value.get("currency") or "").strip()
    salary_value = value.get("value")
    if isinstance(salary_value, dict):
        minimum = salary_value.get("minValue")
        maximum = salary_value.get("maxValue")
        exact = salary_value.get("value")
        unit = str(salary_value.get("unitText") or "").strip()
        if minimum is not None or maximum is not None:
            amount = f"{minimum or ''}-{maximum or ''}".strip("-")
        else:
            amount = str(exact or "")
        return _compact_text(" ".join(item for item in (amount, currency, unit) if item))
    return _compact_text(str(salary_value or ""))


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


def _clean_page_title(value: str) -> str:
    title = _compact_text(value)
    patterns = (
        r"招聘[_\-].*$",
        r"招聘信息[_\-].*$",
        r"[_\-]\s*BOSS直聘.*$",
        r"[_\-]\s*Boss直聘.*$",
    )
    for pattern in patterns:
        title = re.sub(pattern, "", title, flags=re.IGNORECASE).strip()
    return title


def _html_to_text(value: str) -> str:
    text = re.sub(r"<\s*br\s*/?\s*>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"</\s*(?:p|div|li|h[1-6])\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    lines = [_compact_text(line) for line in unescape(text).splitlines()]
    return "\n".join(line for line in lines if line)


def _compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(value or "")).strip()

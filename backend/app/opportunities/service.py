from __future__ import annotations

import json
import re
from hashlib import sha256
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.request import ProxyHandler, Request, build_opener

from ..config import Settings, get_settings
from ..db import connect, json_dump, row_to_dict, rows_to_dicts
from ..jobs.service import create_job
from ..interview.workflow import add_job_event
from ..jobs.browser_capture import canonical_job_url, validate_browser_job_capture
from ..research.web import AgentSearchClient, WebResearchError, is_public_source_url


SUPPORTED_PROVIDERS = {
    "greenhouse", "lever", "ashby", "generic", "workday",
    "moka", "beisen", "dayee",
}
VISIBLE_PLATFORM_PROVIDERS = {"boss"}


class OpportunityScanError(RuntimeError):
    pass


class _CareerLinkParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links: list[dict[str, str]] = []
        self._href = ""
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        attrs_map = {key.lower(): value or "" for key, value in attrs}
        self._href = attrs_map.get("href", "")
        self._text = []

    def handle_data(self, data: str) -> None:
        if self._href:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or not self._href:
            return
        title = " ".join(" ".join(self._text).split())
        url = urljoin(self.base_url, self._href)
        combined = f"{title} {url}".lower()
        if title and any(marker in combined for marker in ("job", "career", "职位", "招聘", "position", "opening")):
            self.links.append({"title": title[:300], "url": url})
        self._href = ""
        self._text = []


def _canonical_company_name(name: str) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", name.lower())


def _is_visible_platform_url(source_url: str, platform: str = "") -> bool:
    try:
        parsed = urlparse(source_url)
    except ValueError:
        return False
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return False
    host = (parsed.hostname or "").lower()
    domains = {
        "boss": "zhipin.com",
        "liepin": "liepin.com",
        "zhaopin": "zhaopin.com",
        "51job": "51job.com",
    }
    candidates = [domains[platform]] if platform in domains else list(domains.values())
    return any(host == domain or host.endswith(f".{domain}") for domain in candidates)


def create_or_update_company(
    *,
    name: str,
    website_url: str = "",
    careers_url: str = "",
    discovery_reason: str = "",
    evidence: list[dict[str, Any]] | None = None,
    followed: bool = False,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    clean_name = " ".join(name.strip().split())
    if not clean_name:
        raise ValueError("公司名称不能为空")
    canonical = _canonical_company_name(clean_name)
    if not canonical:
        raise ValueError("公司名称无法规范化")
    with connect(db_path) as conn:
        existing = conn.execute(
            "SELECT * FROM companies WHERE canonical_name = ?", (canonical,)
        ).fetchone()
        if existing is None:
            cursor = conn.execute(
                """
                INSERT INTO companies (
                    name, canonical_name, website_url, careers_url,
                    discovery_reason, evidence_json, followed
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    clean_name[:200], canonical, website_url[:2000], careers_url[:2000],
                    discovery_reason[:2000], json_dump(evidence or []), int(followed),
                ),
            )
            company_id = int(cursor.lastrowid)
        else:
            company_id = int(existing["id"])
            conn.execute(
                """
                UPDATE companies
                SET name = ?, website_url = COALESCE(NULLIF(?, ''), website_url),
                    careers_url = COALESCE(NULLIF(?, ''), careers_url),
                    discovery_reason = COALESCE(NULLIF(?, ''), discovery_reason),
                    evidence_json = CASE WHEN ? = '[]' THEN evidence_json ELSE ? END,
                    followed = CASE WHEN ? = 1 THEN 1 ELSE followed END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    clean_name[:200], website_url[:2000], careers_url[:2000],
                    discovery_reason[:2000], json_dump(evidence or []), json_dump(evidence or []),
                    int(followed), company_id,
                ),
            )
        row = conn.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    return row_to_dict(row) or {}


def list_companies(
    *,
    followed_only: bool = False,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM companies {'WHERE followed = 1' if followed_only else ''} ORDER BY followed DESC, updated_at DESC"
        ).fetchall()
    return rows_to_dicts(rows)


def detect_provider(source_url: str) -> tuple[str, str]:
    parsed = urlparse(source_url)
    host = (parsed.hostname or "").lower()
    path_parts = [part for part in parsed.path.split("/") if part]
    if "greenhouse.io" in host:
        token = path_parts[0] if path_parts else ""
        return "greenhouse", token
    if host == "jobs.lever.co" or host.endswith(".lever.co"):
        site = path_parts[0] if path_parts else ""
        return "lever", site
    if "ashbyhq.com" in host:
        site = path_parts[0] if path_parts else ""
        return "ashby", site
    if "myworkdayjobs.com" in host:
        return "workday", source_url.rstrip("/")
    if "mokahr.com" in host:
        return "moka", source_url.rstrip("/")
    if "beisen.com" in host or "italent.cn" in host:
        return "beisen", source_url.rstrip("/")
    if "dayee.com" in host:
        return "dayee", source_url.rstrip("/")
    return "generic", source_url.rstrip("/")


def add_opportunity_source(
    *,
    source_url: str,
    company_id: int | None = None,
    provider: str | None = None,
    source_key: str | None = None,
    verified: bool = False,
    access_mode: str | None = None,
    platform: str = "",
    evidence: list[dict[str, Any]] | None = None,
    detection_confidence: float = 0,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if not is_public_source_url(source_url) and not (
        access_mode == "browser_visible_only" and _is_visible_platform_url(source_url, platform)
    ):
        raise ValueError("职位来源必须是可公开访问的 HTTP/HTTPS 地址")
    detected_provider, detected_key = detect_provider(source_url)
    resolved_provider = provider or detected_provider
    resolved_key = source_key or detected_key
    if resolved_provider not in SUPPORTED_PROVIDERS:
        raise ValueError("职位来源类型不支持")
    if not resolved_key:
        raise ValueError("无法识别职位来源标识")
    resolved_access_mode = access_mode or (
        "public_api" if resolved_provider in {"greenhouse", "lever", "ashby"} else "public_page"
    )
    if resolved_access_mode not in {"public_api", "public_page", "browser_visible_only"}:
        raise ValueError("职位来源访问方式不支持")
    with connect(db_path) as conn:
        existing = conn.execute(
            "SELECT * FROM opportunity_sources WHERE provider = ? AND source_key = ?",
            (resolved_provider, resolved_key),
        ).fetchone()
        if existing is None:
            cursor = conn.execute(
                """
                INSERT INTO opportunity_sources (
                    company_id, provider, source_key, source_url, verified,
                    access_mode, platform, detection_confidence, evidence_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    company_id, resolved_provider, resolved_key[:1000], source_url[:2000],
                    int(verified), resolved_access_mode, platform[:50],
                    max(0.0, min(float(detection_confidence), 1.0)), json_dump(evidence or []),
                ),
            )
            source_id = int(cursor.lastrowid)
        else:
            source_id = int(existing["id"])
            conn.execute(
                """
                UPDATE opportunity_sources
                SET company_id = COALESCE(?, company_id), source_url = ?,
                    verified = CASE WHEN ? = 1 THEN 1 ELSE verified END,
                    access_mode = ?, platform = COALESCE(NULLIF(?, ''), platform),
                    detection_confidence = MAX(detection_confidence, ?),
                    evidence_json = CASE WHEN ? = '[]' THEN evidence_json ELSE ? END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    company_id, source_url[:2000], int(verified), resolved_access_mode,
                    platform[:50], max(0.0, min(float(detection_confidence), 1.0)),
                    json_dump(evidence or []), json_dump(evidence or []), source_id,
                ),
            )
        row = conn.execute("SELECT * FROM opportunity_sources WHERE id = ?", (source_id,)).fetchone()
    return row_to_dict(row) or {}


def list_opportunity_sources(
    *,
    enabled_only: bool = False,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            f"""
            SELECT s.*, c.name AS company_name
            FROM opportunity_sources s
            LEFT JOIN companies c ON c.id = s.company_id
            {'WHERE s.enabled = 1' if enabled_only else ''}
            ORDER BY s.verified DESC, s.id
            """
        ).fetchall()
    return rows_to_dicts(rows)


def update_opportunity_source(
    source_id: int,
    *,
    enabled: bool | None = None,
    verified: bool | None = None,
    access_mode: str | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if access_mode is not None and access_mode not in {"public_api", "public_page", "browser_visible_only"}:
        raise ValueError("职位来源访问方式不支持")
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM opportunity_sources WHERE id = ?", (source_id,)).fetchone()
        if row is None:
            raise ValueError("职位来源不存在")
        conn.execute(
            """
            UPDATE opportunity_sources
            SET enabled = COALESCE(?, enabled), verified = COALESCE(?, verified),
                access_mode = COALESCE(?, access_mode), updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                None if enabled is None else int(enabled),
                None if verified is None else int(verified),
                access_mode,
                source_id,
            ),
        )
        updated = conn.execute("SELECT * FROM opportunity_sources WHERE id = ?", (source_id,)).fetchone()
    return row_to_dict(updated) or {}


async def discover_companies(
    query: str,
    *,
    count: int = 8,
    settings: Settings | None = None,
    client: AgentSearchClient | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    resolved_settings = settings or get_settings()
    if not resolved_settings.web_research_enabled and client is None:
        raise OpportunityScanError("全网公司发现需要先启用 AgentSearch")
    search_client = client or AgentSearchClient(
        base_url=resolved_settings.agent_search_base_url,
        token=resolved_settings.agent_search_token,
        timeout_seconds=resolved_settings.web_research_timeout_seconds,
    )
    try:
        results = await search_client.search(
            f"{query} 公司官网 招聘 careers jobs",
            max(3, min(count, 10)),
        )
    except WebResearchError as exc:
        raise OpportunityScanError(str(exc)) from exc
    companies: list[dict[str, Any]] = []
    for result in results:
        url = str(result.get("url") or "")
        if not url or not is_public_source_url(url):
            continue
        host = (urlparse(url).hostname or "").removeprefix("www.")
        raw_title = str(result.get("title") or host).strip()
        name = re.split(r"[|｜—_-]", raw_title)[0].strip() or host.split(".")[0]
        company = create_or_update_company(
            name=name,
            website_url=f"{urlparse(url).scheme}://{urlparse(url).netloc}",
            careers_url=url if any(marker in url.lower() for marker in ("career", "job", "招聘")) else "",
            discovery_reason=str(result.get("snippet") or result.get("content") or "")[:2000],
            evidence=[{"title": raw_title, "url": url, "snippet": str(result.get("snippet") or "")[:1000]}],
            db_path=db_path,
        )
        if company.get("careers_url"):
            try:
                add_opportunity_source(
                    company_id=int(company["id"]),
                    source_url=company["careers_url"],
                    db_path=db_path,
                )
            except ValueError:
                pass
        companies.append(company)
    return {"query": query, "companies": companies, "source_count": len(results)}


def _fetch_json(url: str) -> Any:
    if not is_public_source_url(url):
        raise OpportunityScanError("职位接口地址不安全")
    request = Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "BossCopilot/2.0"},
    )
    with build_opener(ProxyHandler({})).open(request, timeout=20) as response:
        body = response.read(5_000_001)
    if len(body) > 5_000_000:
        raise OpportunityScanError("职位接口响应超过大小限制")
    return json.loads(body.decode("utf-8"))


def _fetch_html(url: str) -> str:
    if not is_public_source_url(url):
        raise OpportunityScanError("招聘页面地址不安全")
    request = Request(
        url,
        headers={"Accept": "text/html", "User-Agent": "BossCopilot/2.0"},
    )
    with build_opener(ProxyHandler({})).open(request, timeout=20) as response:
        body = response.read(2_000_001)
    if len(body) > 2_000_000:
        raise OpportunityScanError("招聘页面响应超过大小限制")
    return body.decode("utf-8", errors="replace")


def _provider_jobs(source: dict[str, Any]) -> list[dict[str, Any]]:
    provider = source["provider"]
    key = source["source_key"]
    if provider == "greenhouse":
        payload = _fetch_json(f"https://boards-api.greenhouse.io/v1/boards/{key}/jobs?content=true")
        return [
            {
                "external_id": str(item.get("id") or ""),
                "canonical_url": item.get("absolute_url") or "",
                "job_title": item.get("title") or "",
                "location": (item.get("location") or {}).get("name") or "",
                "description": unescape(str(item.get("content") or "")),
            }
            for item in payload.get("jobs", [])
        ]
    if provider == "lever":
        payload = _fetch_json(f"https://api.lever.co/v0/postings/{key}?mode=json")
        return [
            {
                "external_id": str(item.get("id") or ""),
                "canonical_url": item.get("hostedUrl") or item.get("applyUrl") or "",
                "job_title": item.get("text") or "",
                "location": (item.get("categories") or {}).get("location") or "",
                "description": unescape(str(item.get("descriptionPlain") or item.get("description") or "")),
            }
            for item in payload
        ]
    if provider == "ashby":
        payload = _fetch_json(f"https://api.ashbyhq.com/posting-api/job-board/{key}?includeCompensation=true")
        return [
            {
                "external_id": str(item.get("id") or item.get("jobUrl") or ""),
                "canonical_url": item.get("jobUrl") or item.get("applyUrl") or "",
                "job_title": item.get("title") or "",
                "location": item.get("location") or "",
                "salary_text": str(item.get("compensation") or ""),
                "description": item.get("descriptionPlain") or item.get("descriptionHtml") or "",
            }
            for item in payload.get("jobs", [])
        ]
    html = _fetch_html(source["source_url"])
    parser = _CareerLinkParser(source["source_url"])
    parser.feed(html)
    return [
        {
            "external_id": "",
            "canonical_url": item["url"],
            "job_title": item["title"],
            "location": "",
            "description": "",
        }
        for item in parser.links[:200]
    ]


def _job_dedup_key(job: dict[str, Any], source_id: int | None) -> str:
    if job.get("external_id"):
        return f"external:{source_id}:{job['external_id']}"
    canonical_url = str(job.get("canonical_url") or "").split("#", 1)[0].rstrip("/")
    if canonical_url:
        return f"url:{canonical_url.lower()}"
    identity = "|".join(
        str(job.get(key) or "").strip().lower()
        for key in ("company_name", "job_title", "location")
    )
    return f"identity:{sha256(identity.encode('utf-8')).hexdigest()}"


def _duplicate_group_key(job: dict[str, Any]) -> str:
    identity = "|".join(
        re.sub(r"\s+", "", str(job.get(key) or "").strip().lower())
        for key in ("company_name", "job_title", "location")
    )
    return sha256(identity.encode("utf-8")).hexdigest() if identity.strip("|") else ""


def _upsert_discovered_job(
    job: dict[str, Any],
    *,
    source_id: int | None,
    scan_run_id: int | None,
    db_path: str | Path | None,
) -> tuple[dict[str, Any], str]:
    description = str(job.get("description") or "")[:50000]
    content_hash = sha256(
        json.dumps(
            {
                "title": job.get("job_title", ""),
                "location": job.get("location", ""),
                "salary": job.get("salary_text", ""),
                "description": description,
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    dedup_key = _job_dedup_key(job, source_id)
    with connect(db_path) as conn:
        existing = conn.execute(
            "SELECT * FROM discovered_jobs WHERE dedup_key = ?", (dedup_key,)
        ).fetchone()
        if existing is None:
            cursor = conn.execute(
                """
                INSERT INTO discovered_jobs (
                    source_id, external_id, canonical_url, company_name, job_title,
                    location, salary_text, description, content_hash, dedup_key,
                    duplicate_group_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    source_id, str(job.get("external_id") or "")[:500],
                    str(job.get("canonical_url") or "")[:2000],
                    str(job.get("company_name") or "")[:200],
                    str(job.get("job_title") or "")[:300],
                    str(job.get("location") or "")[:300],
                    str(job.get("salary_text") or "")[:200], description,
                    content_hash, dedup_key, _duplicate_group_key(job),
                ),
            )
            discovered_id = int(cursor.lastrowid)
            outcome = "created"
        else:
            discovered_id = int(existing["id"])
            outcome = (
                "restored"
                if existing["posting_status"] == "closed"
                else "unchanged" if existing["content_hash"] == content_hash else "updated"
            )
            conn.execute(
                """
                UPDATE discovered_jobs
                SET source_id = COALESCE(?, source_id), company_name = ?, job_title = ?,
                    location = ?, salary_text = ?, description = ?, content_hash = ?,
                    processing_status = CASE WHEN content_hash = ? THEN processing_status ELSE 'queued' END,
                    duplicate_group_key = ?,
                    posting_status = 'active', last_seen_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    source_id, str(job.get("company_name") or existing["company_name"])[:200],
                    str(job.get("job_title") or existing["job_title"])[:300],
                    str(job.get("location") or "")[:300], str(job.get("salary_text") or "")[:200],
                    description, content_hash, content_hash, _duplicate_group_key(job), discovered_id,
                ),
            )
        conn.execute(
            """
            INSERT INTO discovered_job_occurrences (
                discovered_job_id, scan_run_id, content_hash
            ) VALUES (?, ?, ?)
            """,
            (discovered_id, scan_run_id, content_hash),
        )
        row = conn.execute("SELECT * FROM discovered_jobs WHERE id = ?", (discovered_id,)).fetchone()
    return row_to_dict(row) or {}, outcome


def scan_opportunity_source(
    source_id: int,
    *,
    trigger: str = "manual",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        source_row = conn.execute(
            """
            SELECT s.*, c.name AS company_name FROM opportunity_sources s
            LEFT JOIN companies c ON c.id = s.company_id WHERE s.id = ?
            """,
            (source_id,),
        ).fetchone()
        if source_row is None:
            raise ValueError("职位来源不存在")
        run_cursor = conn.execute(
            "INSERT INTO opportunity_scan_runs (source_id, trigger) VALUES (?, ?)",
            (source_id, trigger[:30]),
        )
        run_id = int(run_cursor.lastrowid)
    source = row_to_dict(source_row) or {}
    if source.get("access_mode") == "browser_visible_only":
        raise OpportunityScanError("该国内招聘平台仅支持用户主动读取当前可见页面")
    try:
        raw_jobs = _provider_jobs(source)
        seen_ids: list[int] = []
        created = updated = restored = 0
        results = []
        for raw_job in raw_jobs:
            raw_job["company_name"] = raw_job.get("company_name") or source.get("company_name") or ""
            item, outcome = _upsert_discovered_job(
                raw_job, source_id=source_id, scan_run_id=run_id, db_path=db_path
            )
            seen_ids.append(int(item["id"]))
            created += outcome == "created"
            updated += outcome == "updated"
            restored += outcome == "restored"
            results.append(item)
        with connect(db_path) as conn:
            authoritative_snapshot = source.get("access_mode") == "public_api"
            if seen_ids:
                placeholders = ",".join("?" for _ in seen_ids)
                if authoritative_snapshot:
                    closed = conn.execute(
                        f"""
                        UPDATE discovered_jobs SET posting_status = 'closed', updated_at = CURRENT_TIMESTAMP
                        WHERE source_id = ? AND posting_status IN ('active', 'unknown') AND id NOT IN ({placeholders})
                        """,
                        (source_id, *seen_ids),
                    ).rowcount
                else:
                    closed = conn.execute(
                        f"""
                        UPDATE discovered_jobs SET posting_status = 'closed', updated_at = CURRENT_TIMESTAMP
                        WHERE source_id = ? AND posting_status = 'unknown'
                          AND updated_at <= datetime('now', '-1 day') AND id NOT IN ({placeholders})
                        """,
                        (source_id, *seen_ids),
                    ).rowcount
                    conn.execute(
                        f"""
                        UPDATE discovered_jobs SET posting_status = 'unknown', updated_at = CURRENT_TIMESTAMP
                        WHERE source_id = ? AND posting_status = 'active' AND id NOT IN ({placeholders})
                        """,
                        (source_id, *seen_ids),
                    )
            else:
                if authoritative_snapshot:
                    closed = conn.execute(
                        """
                        UPDATE discovered_jobs SET posting_status = 'closed', updated_at = CURRENT_TIMESTAMP
                        WHERE source_id = ? AND posting_status IN ('active', 'unknown')
                        """,
                        (source_id,),
                    ).rowcount
                else:
                    closed = conn.execute(
                        """
                        UPDATE discovered_jobs SET posting_status = 'closed', updated_at = CURRENT_TIMESTAMP
                        WHERE source_id = ? AND posting_status = 'unknown'
                          AND updated_at <= datetime('now', '-1 day')
                        """,
                        (source_id,),
                    ).rowcount
                    conn.execute(
                        """
                        UPDATE discovered_jobs SET posting_status = 'unknown', updated_at = CURRENT_TIMESTAMP
                        WHERE source_id = ? AND posting_status = 'active'
                        """,
                        (source_id,),
                    )
            conn.execute(
                """
                UPDATE opportunity_scan_runs
                SET status = 'done', discovered_count = ?, updated_count = ?,
                    closed_count = ?, completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (created, updated + restored, closed, run_id),
            )
            conn.execute(
                """
                UPDATE opportunity_sources
                SET verified = 1, last_status = 'ready', last_scanned_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP WHERE id = ?
                """,
                (source_id,),
            )
        return {
            "run_id": run_id,
            "source_id": source_id,
            "status": "done",
            "created": created,
            "updated": updated,
            "restored": restored,
            "closed": closed,
            "jobs": results,
        }
    except Exception as exc:
        with connect(db_path) as conn:
            conn.execute(
                """
                UPDATE opportunity_scan_runs
                SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (str(exc)[:1000], run_id),
            )
            conn.execute(
                """
                UPDATE opportunity_sources SET last_status = 'failed',
                    last_scanned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (source_id,),
            )
        raise OpportunityScanError(f"职位来源扫描失败：{exc}") from exc


def scan_followed_sources(
    *,
    trigger: str = "startup",
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT s.id FROM opportunity_sources s
            JOIN companies c ON c.id = s.company_id
            WHERE s.enabled = 1 AND s.verified = 1 AND c.followed = 1
            ORDER BY s.id
            """
        ).fetchall()
    results = []
    for row in rows:
        try:
            results.append(scan_opportunity_source(int(row["id"]), trigger=trigger, db_path=db_path))
        except OpportunityScanError as exc:
            results.append({"source_id": row["id"], "status": "failed", "message": str(exc)})
    return results


def import_visible_jobs(
    *,
    platform: str,
    page_url: str,
    jobs: list[dict[str, Any]],
    user_initiated: bool,
    captured_at: str,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if platform not in VISIBLE_PLATFORM_PROVIDERS:
        raise ValueError("浏览器岗位平台不支持")
    if not user_initiated:
        raise ValueError("国内招聘平台只允许用户主动触发单页读取")
    if not is_public_source_url(page_url) and not _is_visible_platform_url(page_url, platform):
        raise ValueError("浏览器岗位页面地址不安全")
    if len(jobs) > 100:
        raise ValueError("单页最多导入 100 个当前可见岗位")
    imported = []
    for raw in jobs:
        item = {
            "external_id": str(raw.get("external_id") or "")[:500],
            "canonical_url": str(raw.get("url") or page_url)[:2000],
            "company_name": str(raw.get("company_name") or "")[:200],
            "job_title": str(raw.get("job_title") or "")[:300],
            "location": str(raw.get("location") or "")[:300],
            "salary_text": str(raw.get("salary_text") or "")[:200],
            "description": str(raw.get("description") or "")[:50000],
        }
        if not item["job_title"]:
            continue
        discovered, outcome = _upsert_discovered_job(
            item, source_id=None, scan_run_id=None, db_path=db_path
        )
        discovered["import_outcome"] = outcome
        imported.append(discovered)
    if not imported:
        raise ValueError("当前页面没有可导入的有效岗位")
    return {
        "platform": platform,
        "captured_at": captured_at,
        "page_url": page_url,
        "imported": imported,
        "boundary": "仅处理用户主动触发时当前页面已经可见的岗位；未执行登录、翻页、滚动或验证码处理",
    }


def import_browser_job_detail(
    capture: dict[str, Any], *, db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Store one user-initiated extension capture and refresh its inbox item."""
    if capture.get("user_initiated") is not True:
        raise ValueError("岗位读取必须由用户在当前页面主动触发")
    normalized = validate_browser_job_capture(capture)
    hints = normalized["hints"]
    job = {
        "canonical_url": canonical_job_url(normalized["final_url"]),
        "company_name": hints["company_name"],
        "job_title": hints["job_title"] or normalized["title"],
        "location": hints["location"],
        "salary_text": hints["salary_text"],
        "description": hints["description"] or normalized["visible_text"],
    }
    discovered, outcome = _upsert_discovered_job(
        job, source_id=None, scan_run_id=None, db_path=db_path
    )
    fields = {key: job[key] for key in (
        "company_name", "job_title", "location", "salary_text", "description",
    )}
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO job_capture_snapshots (
                discovered_job_id, canonical_url, platform, schema_version, captured_at,
                content_hash, fields_json, visible_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (discovered["id"], job["canonical_url"], normalized["platform"],
             str(capture.get("schema_version") or "browser-job-capture-v1"),
             normalized["captured_at"], discovered["content_hash"], json_dump(fields),
             normalized["visible_text"]),
        )
        projects = conn.execute(
            "SELECT id FROM jobs WHERE discovered_job_id = ?", (discovered["id"],)
        ).fetchall()
        for project in projects:
            conn.execute(
                """
                UPDATE jobs SET job_title = ?, company_name = ?, location = ?, salary_text = ?,
                    source_url = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
                """,
                (job["job_title"], job["company_name"], job["location"], job["salary_text"],
                 job["canonical_url"], job["description"], project["id"]),
            )
    for project in projects:
        add_job_event(int(project["id"]), "browser_source_refreshed", "已从浏览器刷新岗位信息",
                      f"来源页面：{job['canonical_url']}", db_path=db_path)
    discovered["import_outcome"] = outcome
    return {"job": discovered, "import_outcome": outcome}


def list_discovered_jobs(
    *,
    lifecycle_status: str | None = None,
    posting_status: str | None = None,
    processing_status: str | None = None,
    source_id: int | None = None,
    min_score: int | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    clauses = []
    values: list[Any] = []
    if lifecycle_status:
        clauses.append("d.lifecycle_status = ?")
        values.append(lifecycle_status)
    if posting_status:
        clauses.append("d.posting_status = ?")
        values.append(posting_status)
    if processing_status:
        clauses.append("d.processing_status = ?")
        values.append(processing_status)
    if source_id is not None:
        clauses.append("d.source_id = ?")
        values.append(source_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with connect(db_path) as conn:
        rows = conn.execute(
            f"""
            SELECT d.*, s.provider, c.name AS source_company
            FROM discovered_jobs d
            LEFT JOIN opportunity_sources s ON s.id = d.source_id
            LEFT JOIN companies c ON c.id = s.company_id
            {where}
            ORDER BY d.updated_at DESC, d.id DESC
            """,
            values,
        ).fetchall()
        result = rows_to_dicts(rows)
        for item in result:
            assessment = conn.execute(
                """
                SELECT * FROM discovered_job_assessments
                WHERE discovered_job_id = ? AND status = 'current'
                ORDER BY CASE analysis_tier WHEN 'deep' THEN 0 ELSE 1 END, id DESC
                LIMIT 1
                """,
                (item["id"],),
            ).fetchone()
            item["assessment"] = row_to_dict(assessment)
        if min_score is not None:
            result = [
                item for item in result
                if item.get("assessment") and int(item["assessment"].get("score") or 0) >= min_score
            ]
    return result


def get_discovered_job(
    discovered_job_id: int,
    *,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT d.*, s.provider, s.access_mode, s.platform, c.name AS source_company
            FROM discovered_jobs d
            LEFT JOIN opportunity_sources s ON s.id = d.source_id
            LEFT JOIN companies c ON c.id = s.company_id
            WHERE d.id = ?
            """,
            (discovered_job_id,),
        ).fetchone()
        if row is None:
            raise ValueError("发现岗位不存在")
        result = row_to_dict(row) or {}
        occurrences = conn.execute(
            "SELECT * FROM discovered_job_occurrences WHERE discovered_job_id = ? ORDER BY id DESC LIMIT 50",
            (discovered_job_id,),
        ).fetchall()
        result["occurrences"] = rows_to_dicts(occurrences)
        snapshots = conn.execute(
            """
            SELECT * FROM job_capture_snapshots
            WHERE discovered_job_id = ? ORDER BY captured_at DESC, id DESC LIMIT 20
            """,
            (discovered_job_id,),
        ).fetchall()
        result["capture_snapshots"] = rows_to_dicts(snapshots)
    return result


def update_discovered_job(
    discovered_job_id: int,
    lifecycle_status: str,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if lifecycle_status not in {"discovered", "shortlisted", "saved", "dismissed"}:
        raise ValueError("发现岗位状态不合法")
    with connect(db_path) as conn:
        existing = conn.execute(
            "SELECT * FROM discovered_jobs WHERE id = ?", (discovered_job_id,)
        ).fetchone()
        if existing is None:
            raise ValueError("发现岗位不存在")
        conn.execute(
            "UPDATE discovered_jobs SET lifecycle_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (lifecycle_status, discovered_job_id),
        )
        row = conn.execute(
            "SELECT * FROM discovered_jobs WHERE id = ?", (discovered_job_id,)
        ).fetchone()
    return row_to_dict(row) or {}


def promote_discovered_job(
    discovered_job_id: int,
    *,
    conversation_id: int | None = None,
    strategy_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM discovered_jobs WHERE id = ?", (discovered_job_id,)
        ).fetchone()
    if row is None:
        raise ValueError("发现岗位不存在")
    item = row_to_dict(row) or {}
    job = create_job(
        {
            "conversation_id": conversation_id,
            "job_title": item.get("job_title", ""),
            "company_name": item.get("company_name", ""),
            "location": item.get("location", ""),
            "salary_text": item.get("salary_text", ""),
            "source_url": item.get("canonical_url", ""),
            "description": item.get("description", ""),
            "notes": "从岗位发现池保存",
            "status": "saved",
            "priority": "medium",
        },
        db_path=db_path,
    )
    with connect(db_path) as conn:
        conn.execute(
            "UPDATE jobs SET career_strategy_id = ?, discovered_job_id = ? WHERE id = ?",
            (strategy_id, discovered_job_id, job["id"]),
        )
        conn.execute(
            "UPDATE discovered_jobs SET lifecycle_status = 'saved', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (discovered_job_id,),
        )
    return job

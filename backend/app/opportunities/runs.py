from __future__ import annotations

import asyncio
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
from pathlib import Path
from typing import Any

from ..candidate_core import get_candidate_context
from ..config import get_settings
from ..db import connect, json_dump, row_to_dict, rows_to_dicts
from .service import (
    OpportunityScanError,
    create_or_update_company,
    discover_companies,
    list_discovered_jobs,
    scan_opportunity_source,
)
from ..profile_intelligence import extract_skills
from ..research.web import AgentSearchClient, WebResearchError, is_public_source_url


RUN_MODES = {"scan", "discover", "company_funded", "pipeline", "batch"}
RUN_STATUSES = {
    "queued", "running", "waiting_for_user", "completed", "partial_failed",
    "failed", "cancelled", "interrupted",
}


def create_discovery_run(
    mode: str,
    *,
    config: dict[str, Any] | None = None,
    strategy_id: int | None = None,
    trigger: str = "manual",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if mode not in RUN_MODES:
        raise ValueError("岗位发现模式不支持")
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO discovery_runs (mode, trigger, strategy_id, config_json)
            VALUES (?, ?, ?, ?)
            """,
            (mode, trigger[:30], strategy_id, json_dump(config or {})),
        )
        run_id = int(cursor.lastrowid)
    return get_discovery_run(run_id, db_path=db_path)


def get_discovery_run(
    run_id: int,
    *,
    include_items: bool = True,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM discovery_runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            raise ValueError("岗位发现任务不存在")
        result = row_to_dict(row) or {}
        if include_items:
            items = conn.execute(
                "SELECT * FROM discovery_run_items WHERE run_id = ? ORDER BY id",
                (run_id,),
            ).fetchall()
            result["items"] = rows_to_dicts(items)
    return result


def list_discovery_runs(
    *,
    mode: str | None = None,
    status: str | None = None,
    limit: int = 50,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    values: list[Any] = []
    if mode:
        if mode not in RUN_MODES:
            raise ValueError("岗位发现模式不支持")
        clauses.append("mode = ?")
        values.append(mode)
    if status:
        if status not in RUN_STATUSES:
            raise ValueError("岗位发现任务状态不支持")
        clauses.append("status = ?")
        values.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    values.append(max(1, min(limit, 200)))
    with connect(db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM discovery_runs {where} ORDER BY id DESC LIMIT ?", values
        ).fetchall()
    return rows_to_dicts(rows)


def cancel_discovery_run(run_id: int, *, db_path: str | Path | None = None) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute("SELECT status FROM discovery_runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            raise ValueError("岗位发现任务不存在")
        if row["status"] in {"completed", "failed", "cancelled"}:
            return get_discovery_run(run_id, db_path=db_path)
        conn.execute(
            "UPDATE discovery_runs SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (run_id,),
        )
        conn.execute(
            "UPDATE discovery_run_items SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE run_id = ? AND status IN ('queued', 'running')",
            (run_id,),
        )
    return get_discovery_run(run_id, db_path=db_path)


def retry_discovery_run(run_id: int, *, db_path: str | Path | None = None) -> dict[str, Any]:
    previous = get_discovery_run(run_id, db_path=db_path)
    config = dict(previous.get("config") or {})
    config["retry_of_run_id"] = run_id
    return create_discovery_run(
        previous["mode"],
        config=config,
        strategy_id=previous.get("strategy_id"),
        trigger="retry",
        db_path=db_path,
    )


def interrupt_active_runs(*, db_path: str | Path | None = None) -> int:
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            UPDATE discovery_runs
            SET status = 'interrupted', completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP,
                error_message = CASE WHEN error_message = '' THEN '应用退出前任务未完成' ELSE error_message END
            WHERE status IN ('queued', 'running')
            """
        )
    return int(cursor.rowcount)


def startup_scan_source_ids(*, db_path: str | Path | None = None) -> list[int]:
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT s.id FROM opportunity_sources s
            JOIN companies c ON c.id = s.company_id
            WHERE s.enabled = 1 AND s.verified = 1 AND c.followed = 1
              AND s.access_mode != 'browser_visible_only'
            ORDER BY s.id
            """
        ).fetchall()
    return [int(row["id"]) for row in rows]



def execute_discovery_run(run_id: int, *, db_path: str | Path | None = None) -> dict[str, Any]:
    run = get_discovery_run(run_id, include_items=False, db_path=db_path)
    if run["status"] == "cancelled":
        return get_discovery_run(run_id, db_path=db_path)
    with connect(db_path) as conn:
        conn.execute(
            "UPDATE discovery_runs SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (run_id,),
        )
    try:
        if run["mode"] == "scan":
            _execute_scan(run_id, run.get("config") or {}, db_path)
        elif run["mode"] == "discover":
            asyncio.run(_execute_discover(run_id, run.get("config") or {}, db_path))
        elif run["mode"] == "company_funded":
            asyncio.run(_execute_funded(run_id, run.get("config") or {}, db_path))
        else:
            _execute_pipeline(
                run_id,
                run.get("config") or {},
                strategy_id=run.get("strategy_id"),
                deep_default=run["mode"] == "batch",
                db_path=db_path,
            )
        _finish_run(run_id, db_path)
    except Exception as exc:
        with connect(db_path) as conn:
            conn.execute(
                """
                UPDATE discovery_runs
                SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status != 'cancelled'
                """,
                (str(exc)[:2000], run_id),
            )
    return get_discovery_run(run_id, db_path=db_path)


def _insert_run_item(
    run_id: int,
    *,
    entity_type: str,
    entity_id: int | None,
    label: str,
    stage: str = "queued",
    status: str = "queued",
    db_path: str | Path | None,
) -> int:
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO discovery_run_items (run_id, entity_type, entity_id, label, stage, status)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (run_id, entity_type[:30], entity_id, label[:500], stage[:50], status),
        )
    return int(cursor.lastrowid)


def _update_run_item(
    item_id: int,
    *,
    stage: str,
    status: str,
    result: dict[str, Any] | None = None,
    error: str = "",
    db_path: str | Path | None,
) -> None:
    with connect(db_path) as conn:
        conn.execute(
            """
            UPDATE discovery_run_items
            SET stage = ?, status = ?, result_json = ?, error_message = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (stage[:50], status, json_dump(result or {}), error[:2000], item_id),
        )
    _refresh_run_counts_for_item(item_id, db_path)


def _refresh_run_counts_for_item(item_id: int, db_path: str | Path | None) -> None:
    with connect(db_path) as conn:
        row = conn.execute("SELECT run_id FROM discovery_run_items WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            return
        run_id = int(row["run_id"])
        counts = conn.execute(
            """
            SELECT COUNT(*) total,
                   SUM(status IN ('completed', 'failed', 'cancelled')) completed,
                   SUM(status = 'completed') succeeded,
                   SUM(status = 'failed') failed,
                   SUM(status = 'waiting_for_user') waiting
            FROM discovery_run_items WHERE run_id = ?
            """,
            (run_id,),
        ).fetchone()
        conn.execute(
            """
            UPDATE discovery_runs
            SET total_count = ?, completed_count = ?, succeeded_count = ?,
                failed_count = ?, waiting_count = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                counts["total"] or 0, counts["completed"] or 0, counts["succeeded"] or 0,
                counts["failed"] or 0, counts["waiting"] or 0, run_id,
            ),
        )


def _run_cancelled(run_id: int, db_path: str | Path | None) -> bool:
    with connect(db_path) as conn:
        row = conn.execute("SELECT status FROM discovery_runs WHERE id = ?", (run_id,)).fetchone()
    return row is None or row["status"] == "cancelled"


def _finish_run(run_id: int, db_path: str | Path | None) -> None:
    with connect(db_path) as conn:
        run = conn.execute("SELECT status FROM discovery_runs WHERE id = ?", (run_id,)).fetchone()
        if run is None or run["status"] == "cancelled":
            return
        counts = conn.execute(
            """
            SELECT COUNT(*) total,
                   SUM(status IN ('completed', 'failed', 'cancelled')) completed,
                   SUM(status = 'completed') succeeded,
                   SUM(status = 'failed') failed,
                   SUM(status = 'waiting_for_user') waiting
            FROM discovery_run_items WHERE run_id = ?
            """,
            (run_id,),
        ).fetchone()
        total = int(counts["total"] or 0)
        failed = int(counts["failed"] or 0)
        waiting = int(counts["waiting"] or 0)
        status = "waiting_for_user" if waiting else "partial_failed" if failed and failed < total else "failed" if failed and failed == total else "completed"
        conn.execute(
            """
            UPDATE discovery_runs
            SET status = ?, total_count = ?, completed_count = ?, succeeded_count = ?,
                failed_count = ?, waiting_count = ?, completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                status, total, int(counts["completed"] or 0), int(counts["succeeded"] or 0),
                failed, waiting, run_id,
            ),
        )


def _execute_scan(run_id: int, config: dict[str, Any], db_path: str | Path | None) -> None:
    source_ids = [int(item) for item in config.get("source_ids") or [] if int(item) > 0]
    with connect(db_path) as conn:
        if source_ids:
            placeholders = ",".join("?" for _ in source_ids)
            rows = conn.execute(
                f"""
                SELECT s.*, c.name company_name FROM opportunity_sources s
                LEFT JOIN companies c ON c.id = s.company_id
                WHERE s.enabled = 1 AND s.id IN ({placeholders}) ORDER BY s.id
                """,
                source_ids,
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT s.*, c.name company_name FROM opportunity_sources s
                LEFT JOIN companies c ON c.id = s.company_id
                WHERE s.enabled = 1 AND (s.verified = 1 OR c.followed = 1) ORDER BY s.id
                """
            ).fetchall()
    sources = rows_to_dicts(rows)
    runnable: list[tuple[dict[str, Any], int]] = []
    for source in sources:
        item_id = _insert_run_item(
            run_id, entity_type="source", entity_id=int(source["id"]),
            label=f"{source.get('company_name') or '未关联公司'} · {source.get('provider')}",
            db_path=db_path,
        )
        if source.get("access_mode") == "browser_visible_only":
            _update_run_item(
                item_id, stage="open_visible_page", status="waiting_for_user",
                result={"source_url": source.get("source_url"), "platform": source.get("platform")},
                db_path=db_path,
            )
        else:
            runnable.append((source, item_id))

    def scan_one(source: dict[str, Any], item_id: int) -> None:
        if _run_cancelled(run_id, db_path):
            _update_run_item(item_id, stage="cancelled", status="cancelled", db_path=db_path)
            return
        _update_run_item(item_id, stage="fetching", status="running", db_path=db_path)
        try:
            result = scan_opportunity_source(int(source["id"]), trigger="discovery_run", db_path=db_path)
            _update_run_item(item_id, stage="completed", status="completed", result=result, db_path=db_path)
        except (ValueError, OpportunityScanError) as exc:
            _update_run_item(item_id, stage="failed", status="failed", error=str(exc), db_path=db_path)

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(scan_one, source, item_id) for source, item_id in runnable]
        for future in as_completed(futures):
            future.result()


async def _execute_discover(run_id: int, config: dict[str, Any], db_path: str | Path | None) -> None:
    names = [str(item).strip() for item in config.get("company_names") or [] if str(item).strip()]
    query = str(config.get("query") or "").strip()
    searches = names or ([query] if query else [])
    if not searches:
        raise ValueError("请提供公司名单或发现条件")
    for term in searches[:30]:
        if _run_cancelled(run_id, db_path):
            break
        item_id = _insert_run_item(run_id, entity_type="company_query", entity_id=None, label=term, db_path=db_path)
        _update_run_item(item_id, stage="searching", status="running", db_path=db_path)
        try:
            result = await discover_companies(term, count=int(config.get("limit") or 8), db_path=db_path)
            _update_run_item(item_id, stage="detected", status="completed", result=result, db_path=db_path)
        except (ValueError, OpportunityScanError) as exc:
            _update_run_item(item_id, stage="failed", status="failed", error=str(exc), db_path=db_path)


async def _execute_funded(run_id: int, config: dict[str, Any], db_path: str | Path | None) -> None:
    window = int(config.get("funding_window_days") or 90)
    regions = " ".join(str(item) for item in config.get("regions") or [])
    industries = " ".join(str(item) for item in config.get("industries") or [])
    query = " ".join(part for part in (regions, industries, f"近{window}天 完成融资 公司 公告") if part).strip()
    item_id = _insert_run_item(run_id, entity_type="funding_query", entity_id=None, label=query, db_path=db_path)
    _update_run_item(item_id, stage="searching", status="running", db_path=db_path)
    try:
        settings = get_settings()
        if not settings.web_research_enabled:
            raise OpportunityScanError("融资公司发现需要先启用 AgentSearch")
        client = AgentSearchClient(
            base_url=settings.agent_search_base_url,
            token=settings.agent_search_token,
            timeout_seconds=settings.web_research_timeout_seconds,
        )
        results = await client.search(
            f"{query} 融资公告 投资机构 投资方",
            max(3, min(int(config.get("limit") or 12), 30)),
        )
        signal_ids: list[int] = []
        companies: list[dict[str, Any]] = []
        for source in results:
            source_url = str(source.get("url") or "")
            if not source_url or not is_public_source_url(source_url):
                continue
            source_title = str(source.get("title") or "近期融资线索").strip()
            company_name = re.split(
                r"(?:完成|获|宣布|融资|：|:|\||｜|—|-)", source_title, maxsplit=1
            )[0].strip()
            if len(company_name) < 2:
                continue
            company = create_or_update_company(
                name=company_name[:200],
                discovery_reason=str(source.get("snippet") or source.get("content") or "")[:2000],
                evidence=[{
                    "title": source_title,
                    "url": source_url,
                    "snippet": str(source.get("snippet") or "")[:1000],
                    "signal_type": "funding",
                }],
                db_path=db_path,
            )
            companies.append(company)
            event_key = sha256(f"funding|{company['id']}|{source_url}".encode("utf-8")).hexdigest()
            with connect(db_path) as conn:
                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO company_signals (
                        company_id, signal_type, event_key, title, source_url,
                        source_title, source_excerpt, confidence
                    ) VALUES (?, 'funding', ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        company["id"], event_key, source_title[:500], source_url[:2000],
                        source_title[:500], str(source.get("snippet") or "")[:3000], 0.6,
                    ),
                )
                if cursor.rowcount:
                    signal_ids.append(int(cursor.lastrowid))
        _update_run_item(
            item_id, stage="signals_saved", status="completed",
            result={
                "query": query, "companies": companies, "source_count": len(results),
                "signal_ids": signal_ids, "limitation": "融资信号不代表公司正在扩招",
            },
            db_path=db_path,
        )
    except (ValueError, OpportunityScanError, WebResearchError) as exc:
        _update_run_item(item_id, stage="failed", status="failed", error=str(exc), db_path=db_path)


def _execute_pipeline(
    run_id: int,
    config: dict[str, Any],
    *,
    strategy_id: int | None,
    deep_default: bool,
    db_path: str | Path | None,
) -> None:
    candidate = get_candidate_context("triage", strategy_id=strategy_id, db_path=db_path)
    resolved_strategy_id = (candidate.get("strategy") or {}).get("id")
    ids = [int(item) for item in config.get("job_ids") or [] if int(item) > 0]
    jobs = list_discovered_jobs(db_path=db_path)
    if ids:
        allowed = set(ids[:200])
        jobs = [job for job in jobs if int(job["id"]) in allowed]
    else:
        jobs = [job for job in jobs if job.get("lifecycle_status") == "discovered"][:200]
    local_results: list[tuple[dict[str, Any], int, dict[str, Any]]] = []
    for job in jobs:
        item_id = _insert_run_item(
            run_id, entity_type="job", entity_id=int(job["id"]),
            label=f"{job.get('company_name', '')} · {job.get('job_title', '')}", db_path=db_path,
        )
        if _run_cancelled(run_id, db_path):
            _update_run_item(item_id, stage="cancelled", status="cancelled", db_path=db_path)
            continue
        _update_run_item(item_id, stage="local_triage", status="running", db_path=db_path)
        try:
            assessment = _local_assessment(job, candidate)
            assessment_id = _save_assessment(job, assessment, resolved_strategy_id, candidate, "local", db_path)
            local_results.append((job, item_id, {**assessment, "assessment_id": assessment_id}))
            _update_run_item(
                item_id, stage="local_evaluated", status="completed",
                result={**assessment, "assessment_id": assessment_id}, db_path=db_path,
            )
        except Exception as exc:
            with connect(db_path) as conn:
                conn.execute(
                    "UPDATE discovered_jobs SET processing_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (job["id"],),
                )
            _update_run_item(item_id, stage="failed", status="failed", error=str(exc), db_path=db_path)

    # 发现池始终保持轻量：batch 只代表批量处理，不升级为完整研究。
    # 完整 A–G 和深度研究必须在用户保存岗位项目后单独触发。
    return


def _local_assessment(job: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    description = str(job.get("description") or "")
    job_skills = extract_skills(description)
    fact_text = " ".join(str(item.get("statement") or "") for item in candidate.get("confirmed_facts") or [])
    fact_skills = set(extract_skills(fact_text))
    matched = [skill for skill in job_skills if skill in fact_skills]
    gaps = [skill for skill in job_skills if skill not in fact_skills]
    strategy = candidate.get("strategy") or {}
    haystack = f"{job.get('company_name', '')} {job.get('job_title', '')} {description}".lower()
    hard_conflicts = [
        f"屏蔽关键词：{word}" for word in strategy.get("blocked_keywords") or []
        if str(word).lower() in haystack
    ]
    hard_conflicts.extend(
        f"不考虑公司：{company}" for company in strategy.get("blocked_companies") or []
        if str(company).lower() in str(job.get("company_name") or "").lower()
    )
    reasons: list[str] = []
    if matched:
        reasons.append(f"已确认事实覆盖 {len(matched)} 项岗位技能")
    if gaps:
        reasons.append(f"有 {len(gaps)} 项要求暂缺已确认证据")
    if not description.strip():
        reasons.append("岗位描述不完整，当前只能做有限评估")

    dimensions: dict[str, dict[str, Any]] = {}
    target_roles = [str(item).lower() for item in strategy.get("target_roles") or [] if str(item).strip()]
    title = str(job.get("job_title") or "").lower()
    if target_roles:
        role_score = 100 if any(role in title or title in role for role in target_roles) else 45 if any(
            token in title for role in target_roles for token in re.findall(r"[a-z0-9+#.]+|[\u4e00-\u9fff]{2,}", role)
        ) else 20
        dimensions["strategy_fit"] = {"score": role_score, "weight": 30, "status": "evaluated"}

    locations = [str(item).lower() for item in strategy.get("locations") or [] if str(item).strip()]
    work_modes = [str(item).lower() for item in strategy.get("work_modes") or [] if str(item).strip()]
    job_location = str(job.get("location") or "").lower()
    mode_text = f"{job_location} {description}".lower()
    if locations or work_modes:
        location_ok = not locations or any(item in job_location for item in locations)
        mode_aliases = {
            "remote": ("remote", "远程", "居家"), "hybrid": ("hybrid", "混合", "部分远程"),
            "onsite": ("onsite", "on-site", "现场", "坐班"), "远程": ("remote", "远程", "居家"),
            "混合": ("hybrid", "混合", "部分远程"), "现场": ("onsite", "on-site", "现场", "坐班"),
        }
        mode_known = any(token in mode_text for tokens in mode_aliases.values() for token in tokens)
        mode_ok = not work_modes or any(
            any(token in mode_text for token in mode_aliases.get(mode, (mode,))) for mode in work_modes
        )
        if job_location or mode_known:
            dimensions["location_work_mode"] = {
                "score": 100 if location_ok and mode_ok else 55 if location_ok or mode_ok else 0,
                "weight": 25, "status": "evaluated",
            }

    desired_salary = strategy.get("salary") or {}
    salary_text = str(job.get("salary_text") or "")
    salary_numbers = [float(item) for item in re.findall(r"\d+(?:\.\d+)?", salary_text.replace(",", ""))]
    desired_min = None
    for key in ("min", "minimum", "monthly_min"):
        raw_desired = desired_salary.get(key)
        if raw_desired in (None, ""):
            continue
        match = re.search(r"\d+(?:\.\d+)?", str(raw_desired).replace(",", ""))
        if match:
            desired_min = float(match.group())
            if "k" in str(raw_desired).lower() or "千" in str(raw_desired):
                desired_min *= 1000
            elif "万" in str(raw_desired):
                desired_min *= 10_000
        break
    if desired_salary and salary_numbers:
        offered_max = max(salary_numbers)
        if any(unit in salary_text.lower() for unit in ("k", "千")):
            offered_max *= 1000
        dimensions["salary"] = {
            "score": 100 if desired_min is None or offered_max >= desired_min else max(0, round(offered_max / desired_min * 100)),
            "weight": 20, "status": "evaluated",
        }

    if job_skills:
        dimensions["confirmed_evidence"] = {
            "score": round(len(matched) / len(job_skills) * 100), "weight": 25, "status": "evaluated",
        }

    available_weight = sum(int(item["weight"]) for item in dimensions.values())
    raw_score = round(sum(float(item["score"]) * int(item["weight"]) for item in dimensions.values()) / available_weight) if available_weight else 0
    coverage = available_weight
    confidence = "high" if coverage >= 85 else "medium" if coverage >= 60 else "low"
    soft_risks: list[str] = []
    if not description.strip():
        soft_risks.append("岗位描述不完整")
    if desired_salary and not salary_numbers:
        soft_risks.append("岗位未披露可比较薪资")
    if any(token in haystack for token in ("外包", "劳务派遣", "第三方合同")):
        soft_risks.append("用工关系需要核实")
    if not str(job.get("company_name") or "").strip():
        soft_risks.append("招聘主体信息不完整")
    soft_risks = soft_risks[:3]
    score = max(0, raw_score - len(soft_risks) * 5)
    posting_status = str(job.get("posting_status") or "").lower()
    if posting_status in {"closed", "offline", "expired", "unavailable"}:
        verdict = "skip"
    elif hard_conflicts:
        verdict = "fail"
    elif score >= 70:
        verdict = "pass"
    elif score >= 55:
        verdict = "marginal"
    else:
        verdict = "fail"
    recommendation = {
        "pass": "strong", "marginal": "good", "fail": "not_recommended", "skip": "not_recommended",
    }[verdict]
    return {
        "score": score,
        "recommendation": recommendation,
        "verdict": verdict,
        "triage_dimensions": dimensions,
        "coverage": coverage,
        "confidence": confidence,
        "matched_skills": matched,
        "evidence_gaps": gaps,
        "hard_conflicts": hard_conflicts,
        "soft_risks": soft_risks,
        "reasons": reasons,
    }



def _save_assessment(
    job: dict[str, Any],
    assessment: dict[str, Any],
    strategy_id: int | None,
    candidate: dict[str, Any],
    tier: str,
    db_path: str | Path | None,
) -> int:
    with connect(db_path) as conn:
        conn.execute(
            """
            UPDATE discovered_job_assessments SET status = 'stale'
            WHERE discovered_job_id = ? AND ((strategy_id IS NULL AND ? IS NULL) OR strategy_id = ?)
              AND status = 'current'
            """,
            (job["id"], strategy_id, strategy_id),
        )
        cursor = conn.execute(
            """
            INSERT INTO discovered_job_assessments (
                discovered_job_id, strategy_id, analysis_tier, score, recommendation, verdict,
                triage_dimensions_json, coverage, confidence,
                matched_skills_json, evidence_gaps_json, hard_conflicts_json, soft_risks_json, reasons_json,
                context_fingerprint, job_fingerprint, knowledge_revision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job["id"], strategy_id, tier, int(assessment["score"]), assessment["recommendation"], assessment["verdict"],
                json_dump(assessment.get("triage_dimensions") or {}), float(assessment.get("coverage") or 0), assessment.get("confidence") or "low",
                json_dump(assessment.get("matched_skills") or []), json_dump(assessment.get("evidence_gaps") or []),
                json_dump(assessment.get("hard_conflicts") or []), json_dump(assessment.get("soft_risks") or []),
                json_dump(assessment.get("reasons") or []),
                candidate.get("fingerprint") or "", job.get("content_hash") or "",
                int((candidate.get("profile") or {}).get("knowledge_revision") or 0),
            ),
        )
        conn.execute(
            "UPDATE discovered_jobs SET processing_status = 'evaluated', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (job["id"],),
        )
    return int(cursor.lastrowid)


def list_discovered_job_assessments(
    discovered_job_id: int, *, db_path: str | Path | None = None
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        exists = conn.execute("SELECT id FROM discovered_jobs WHERE id = ?", (discovered_job_id,)).fetchone()
        if exists is None:
            raise ValueError("发现岗位不存在")
        rows = conn.execute(
            "SELECT * FROM discovered_job_assessments WHERE discovered_job_id = ? ORDER BY id DESC",
            (discovered_job_id,),
        ).fetchall()
    return rows_to_dicts(rows)


def list_company_signals(company_id: int, *, db_path: str | Path | None = None) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM company_signals WHERE company_id = ? ORDER BY id DESC", (company_id,)
        ).fetchall()
    return rows_to_dicts(rows)

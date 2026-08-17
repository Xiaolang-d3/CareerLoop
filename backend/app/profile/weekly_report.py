from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from ..db import connect, json_dump, row_to_dict, rows_to_dicts

# A rolling window keeps the report cheap and readable; older weeks stay in the
# database but are not resurfaced automatically.
HISTORY_LIMIT = 12
BACKFILL_WEEKS = 8


def _week_start(reference: date) -> date:
    return reference - timedelta(days=reference.weekday())


def _iter_recent_completed_weeks(today: date, count: int) -> list[tuple[date, date]]:
    """Return up to `count` most-recent fully completed ISO weeks, newest first."""
    current_start = _week_start(today)
    periods = []
    for index in range(1, count + 1):
        start = current_start - timedelta(weeks=index)
        periods.append((start, start + timedelta(days=7)))
    return periods


def _collect_metrics(conn: sqlite3.Connection, period_start: date, period_end: date) -> dict[str, Any]:
    """Aggregate this user's own tracked activity for [period_start, period_end).

    Every figure is derived from locally stored records (discovered jobs,
    saved jobs, stage events, evaluations, discovery scans); there is no
    external market data source.
    """
    start_text, end_text = period_start.isoformat(), period_end.isoformat()

    discovered_count = conn.execute(
        """
        SELECT COUNT(*) FROM discovered_jobs
        WHERE date(first_seen_at) >= date(?) AND date(first_seen_at) < date(?)
        """,
        (start_text, end_text),
    ).fetchone()[0]

    company_rows = conn.execute(
        """
        SELECT company_name, COUNT(*) AS n FROM discovered_jobs
        WHERE date(first_seen_at) >= date(?) AND date(first_seen_at) < date(?)
          AND trim(company_name) != ''
        GROUP BY company_name ORDER BY n DESC, company_name ASC LIMIT 5
        """,
        (start_text, end_text),
    ).fetchall()
    top_companies = [{"name": row["company_name"], "count": int(row["n"])} for row in company_rows]

    saved_jobs = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE date(created_at) >= date(?) AND date(created_at) < date(?)",
        (start_text, end_text),
    ).fetchone()[0]

    stage_rows = conn.execute(
        """
        SELECT to_stage, COUNT(DISTINCT job_id) AS n FROM application_stage_events
        WHERE date(occurred_at) >= date(?) AND date(occurred_at) < date(?)
        GROUP BY to_stage
        """,
        (start_text, end_text),
    ).fetchall()
    stage_counts = {row["to_stage"]: int(row["n"]) for row in stage_rows}

    eval_row = conn.execute(
        """
        SELECT COUNT(*) AS n, AVG(overall_score) AS avg_score FROM job_evaluations
        WHERE status = 'completed' AND date(created_at) >= date(?) AND date(created_at) < date(?)
        """,
        (start_text, end_text),
    ).fetchone()
    average_score = round(eval_row["avg_score"], 1) if eval_row["avg_score"] is not None else None

    scans_completed = conn.execute(
        """
        SELECT COUNT(*) FROM discovery_runs
        WHERE status = 'completed' AND date(created_at) >= date(?) AND date(created_at) < date(?)
        """,
        (start_text, end_text),
    ).fetchone()[0]

    return {
        "discovered_jobs": int(discovered_count),
        "top_companies": top_companies,
        "saved_jobs": int(saved_jobs),
        "applications_submitted": stage_counts.get("applied", 0),
        "entered_interview": stage_counts.get("interview", 0) + stage_counts.get("recruiter_screen", 0),
        "offers": stage_counts.get("offer", 0) + stage_counts.get("hired", 0),
        "rejections": stage_counts.get("rejected", 0),
        "evaluations_completed": int(eval_row["n"] or 0),
        "average_match_score": average_score,
        "scans_completed": int(scans_completed),
    }


def _delta_phrase(current: int, previous: int, unit: str) -> str:
    diff = current - previous
    if diff > 0:
        return f"比上周增加 {diff} {unit}"
    if diff < 0:
        return f"比上周减少 {abs(diff)} {unit}"
    return "与上周持平"


def _build_highlights(current: dict[str, Any], previous: dict[str, Any]) -> list[str]:
    lines = [
        f"本周新发现 {current['discovered_jobs']} 个岗位机会，"
        f"{_delta_phrase(current['discovered_jobs'], previous['discovered_jobs'], '个')}。"
    ]
    if current["top_companies"]:
        names = "、".join(item["name"] for item in current["top_companies"][:3])
        lines.append(f"本周出现频率较高的公司：{names}。")
    lines.append(
        f"新增投递 {current['applications_submitted']} 份，"
        f"进入面试 {current['entered_interview']} 家，收到 Offer {current['offers']} 个。"
    )
    if current["evaluations_completed"]:
        score_text = (
            f"，平均匹配分 {current['average_match_score']}"
            if current["average_match_score"] is not None
            else ""
        )
        lines.append(f"本周完成 {current['evaluations_completed']} 次岗位评估{score_text}。")
    has_activity = any(
        current[key]
        for key in ("discovered_jobs", "saved_jobs", "applications_submitted", "evaluations_completed")
    )
    if not has_activity:
        lines.append("本周没有新的求职活动记录，可以启用机会来源自动扫描或手动添加岗位。")
    return lines


def generate_weekly_report(
    period_start: date, period_end: date, *, db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        metrics = _collect_metrics(conn, period_start, period_end)
        previous_metrics = _collect_metrics(conn, period_start - timedelta(days=7), period_start)
        highlights = _build_highlights(metrics, previous_metrics)
        conn.execute(
            """
            INSERT INTO career_weekly_reports (period_start, period_end, metrics_json, highlights_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(period_start, period_end) DO UPDATE SET
                metrics_json = excluded.metrics_json,
                highlights_json = excluded.highlights_json,
                generated_at = CURRENT_TIMESTAMP
            """,
            (period_start.isoformat(), period_end.isoformat(), json_dump(metrics), json_dump(highlights)),
        )
        row = conn.execute(
            "SELECT * FROM career_weekly_reports WHERE period_start = ? AND period_end = ?",
            (period_start.isoformat(), period_end.isoformat()),
        ).fetchone()
    return row_to_dict(row) or {}


def list_weekly_reports(
    *, limit: int = HISTORY_LIMIT, db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM career_weekly_reports ORDER BY period_start DESC LIMIT ?", (limit,),
        ).fetchall()
    return rows_to_dicts(rows)


def ensure_recent_weekly_reports(
    *, db_path: str | Path | None = None, backfill_weeks: int = BACKFILL_WEEKS,
) -> None:
    """Generate any missing report for the last `backfill_weeks` completed weeks.

    Safe to call often: existing periods are left untouched thanks to the
    unique (period_start, period_end) constraint check below.
    """
    today = date.today()
    with connect(db_path) as conn:
        existing = {
            row["period_start"] for row in conn.execute(
                "SELECT period_start FROM career_weekly_reports"
            ).fetchall()
        }
    for start, end in _iter_recent_completed_weeks(today, backfill_weeks):
        if start.isoformat() in existing:
            continue
        generate_weekly_report(start, end, db_path=db_path)


def current_week_snapshot(*, db_path: str | Path | None = None) -> dict[str, Any]:
    """A live, unsaved view of the in-progress week for immediate feedback."""
    today = date.today()
    start = _week_start(today)
    end_exclusive = today + timedelta(days=1)
    previous_start = start - timedelta(days=7)
    with connect(db_path) as conn:
        metrics = _collect_metrics(conn, start, end_exclusive)
        previous_metrics = _collect_metrics(conn, previous_start, start)
    return {
        "period_start": start.isoformat(),
        "period_end": (start + timedelta(days=7)).isoformat(),
        "metrics": metrics,
        "highlights": _build_highlights(metrics, previous_metrics),
        "is_partial": True,
        "generated_at": None,
    }


def weekly_reports_overview(*, db_path: str | Path | None = None) -> dict[str, Any]:
    ensure_recent_weekly_reports(db_path=db_path)
    return {
        "current": current_week_snapshot(db_path=db_path),
        "history": list_weekly_reports(db_path=db_path),
    }

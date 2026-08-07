from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .db import connect


WINDOW_OPTIONS = {7, 30, 90}
TERMINAL_TOOL_STATUSES = {"done", "failed", "blocked", "waiting_approval", "cancelled"}
SYSTEM_EVENT_TOOLS = {"agent_thinking", "agent_planner", "model_provider"}
TOOL_LABELS = {
    "analyze_resume_against_jd": "简历与 JD 分析",
    "search_resume_evidence": "简历证据检索",
    "generate_tailored_resume_content": "定制简历内容",
    "generate_interview_advice": "面试建议",
    "research_company": "公司研究",
    "search_public_web": "公开网络搜索",
    "citation_validator": "引用校验",
}


def _json_object(value: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(value or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _route_from_agent(agent: dict[str, Any]) -> str:
    plan = agent.get("plan")
    if isinstance(plan, dict) and isinstance(plan.get("route"), str):
        return plan["route"]
    for event in agent.get("events") or []:
        if not isinstance(event, dict) or event.get("tool_name") != "agent_thinking":
            continue
        data = event.get("data")
        if isinstance(data, dict) and isinstance(data.get("route"), str):
            return data["route"]
    return "conversation"


def _tool_calls(agent: dict[str, Any]) -> list[dict[str, Any]]:
    calls: dict[str, dict[str, Any]] = {}
    for event in agent.get("events") or []:
        if not isinstance(event, dict):
            continue
        tool_name = str(event.get("tool_name") or "")
        tool_call_id = str(event.get("tool_call_id") or "")
        if not tool_name or not tool_call_id or tool_name in SYSTEM_EVENT_TOOLS:
            continue
        current = calls.get(tool_call_id)
        status = str(event.get("status") or "")
        if current is None or status in TERMINAL_TOOL_STATUSES:
            calls[tool_call_id] = {
                "id": tool_call_id,
                "name": tool_name,
                "label": TOOL_LABELS.get(tool_name, tool_name.replace("_", " ")),
                "status": status or "unknown",
            }
    return list(calls.values())


def _percentile(values: list[int], percentile: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * percentile)))
    return ordered[index]


def get_agent_operations_snapshot(
    days: int = 7,
    limit: int = 20,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if days not in WINDOW_OPTIONS:
        raise ValueError("运行统计仅支持 7、30 或 90 天")
    limit = max(1, min(limit, 100))
    cutoff_modifier = f"-{days} days"

    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT m.id, m.conversation_id, m.task_id, m.payload_json, m.created_at,
                   COALESCE(c.title, '已删除对话') AS conversation_title
            FROM chat_messages m
            LEFT JOIN conversations c ON c.id = m.conversation_id
            WHERE m.role = 'assistant'
              AND json_extract(m.payload_json, '$.agent') IS NOT NULL
              AND m.created_at >= datetime('now', ?)
            ORDER BY m.id DESC
            """,
            (cutoff_modifier,),
        ).fetchall()
        model_rows = conn.execute(
            """
            SELECT status, latency_ms, total_tokens, created_at
            FROM model_service_events
            WHERE created_at >= datetime('now', ?)
            ORDER BY id DESC
            """,
            (cutoff_modifier,),
        ).fetchall()

    today = datetime.now(timezone.utc).date()
    trend_by_date: dict[str, dict[str, Any]] = {}
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        key = day.isoformat()
        trend_by_date[key] = {
            "date": key,
            "label": f"{day.month}/{day.day}",
            "total": 0,
            "done": 0,
            "failed": 0,
            "waiting_user": 0,
            "cancelled": 0,
        }

    status_counts: Counter[str] = Counter()
    route_counts: Counter[str] = Counter()
    tool_counts: Counter[str] = Counter()
    tool_failures: Counter[str] = Counter()
    recent_runs: list[dict[str, Any]] = []
    total_rounds = 0
    total_tool_calls = 0

    for row in rows:
        payload = _json_object(row["payload_json"])
        agent = payload.get("agent")
        if not isinstance(agent, dict):
            continue
        status = str(agent.get("status") or "failed")
        if status not in {"done", "failed", "waiting_user", "cancelled"}:
            status = "failed"
        route = _route_from_agent(agent)
        calls = _tool_calls(agent)
        status_counts[status] += 1
        route_counts[route] += 1
        total_rounds += int(agent.get("rounds") or 0)
        total_tool_calls += len(calls)
        for call in calls:
            tool_counts[call["name"]] += 1
            if call["status"] in {"failed", "blocked", "waiting_approval", "cancelled"}:
                tool_failures[call["name"]] += 1

        created_at = str(row["created_at"] or "")
        day_key = created_at[:10]
        if day_key in trend_by_date:
            trend_by_date[day_key]["total"] += 1
            trend_by_date[day_key][status] += 1

        if len(recent_runs) < limit:
            plan = agent.get("plan") if isinstance(agent.get("plan"), dict) else {}
            error = agent.get("error") if isinstance(agent.get("error"), dict) else {}
            recent_runs.append(
                {
                    "id": f"message-{row['id']}",
                    "message_id": row["id"],
                    "conversation_id": row["conversation_id"],
                    "conversation_title": row["conversation_title"],
                    "task_id": row["task_id"],
                    "status": status,
                    "provider": str(agent.get("provider") or ""),
                    "platform": str(agent.get("platform") or ""),
                    "route": route,
                    "goal": str(plan.get("goal") or row["conversation_title"]),
                    "rounds": int(agent.get("rounds") or 0),
                    "tool_call_count": len(calls),
                    "tools": [call["label"] for call in calls],
                    "error_code": str(error.get("code") or ""),
                    "error_message": str(error.get("message") or ""),
                    "created_at": created_at,
                }
            )

    total_runs = sum(status_counts.values())
    model_latencies = [int(row["latency_ms"] or 0) for row in model_rows]
    successful_models = sum(1 for row in model_rows if row["status"] == "success")
    total_tokens = sum(int(row["total_tokens"] or 0) for row in model_rows)
    tool_breakdown = [
        {
            "name": name,
            "label": TOOL_LABELS.get(name, name.replace("_", " ")),
            "count": count,
            "failed": tool_failures[name],
        }
        for name, count in tool_counts.most_common(8)
    ]
    route_breakdown = [
        {"route": route, "count": count}
        for route, count in route_counts.most_common(8)
    ]
    latest_timestamps = [str(row["created_at"]) for row in rows[:1]]
    latest_timestamps += [str(row["created_at"]) for row in model_rows[:1]]

    return {
        "window_days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "freshness_at": max(latest_timestamps) if latest_timestamps else None,
        "summary": {
            "total_runs": total_runs,
            "successful_runs": status_counts["done"],
            "failed_runs": status_counts["failed"],
            "waiting_runs": status_counts["waiting_user"],
            "cancelled_runs": status_counts["cancelled"],
            "success_rate": round(status_counts["done"] * 100 / total_runs, 1) if total_runs else None,
            "total_tool_calls": total_tool_calls,
            "average_rounds": round(total_rounds / total_runs, 1) if total_runs else None,
            "model_requests": len(model_rows),
            "model_success_rate": round(successful_models * 100 / len(model_rows), 1) if model_rows else None,
            "model_p95_latency_ms": _percentile(model_latencies, 0.95),
            "total_tokens": total_tokens,
        },
        "status_breakdown": [
            {"status": status, "count": status_counts[status]}
            for status in ("done", "failed", "waiting_user", "cancelled")
        ],
        "trend": list(trend_by_date.values()),
        "tool_breakdown": tool_breakdown,
        "route_breakdown": route_breakdown,
        "recent_runs": recent_runs,
        "coverage": {
            "run_source": "chat_messages.payload_json.agent",
            "model_source": "model_service_events",
            "precise_run_latency": False,
            "tokens_attributed_to_run": False,
        },
    }

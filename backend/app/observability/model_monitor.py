from __future__ import annotations

import math
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..agent_settings import get_model_connection
from ..db import connect, row_to_dict


ERROR_LABELS = {
    "authentication_failed": "认证失败",
    "rate_limited": "服务限流",
    "request_timeout": "响应超时",
    "service_unavailable": "连接失败",
    "provider_error": "服务异常",
    "not_configured": "未完成配置",
}


def record_model_service_event(
    *,
    request_kind: str,
    status: str,
    latency_ms: int,
    model_name: str,
    base_url: str | None,
    error_code: str = "",
    error_message: str = "",
    total_tokens: int = 0,
    response_id: str = "",
    db_path: str | Path | None = None,
) -> None:
    """Persist only operational metadata; prompts and responses are never stored."""
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO model_service_events (
                request_kind, status, error_code, error_message, latency_ms,
                total_tokens, model_name, base_url, response_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                request_kind,
                status,
                error_code,
                error_message[:300],
                max(0, round(latency_ms)),
                max(0, total_tokens),
                model_name,
                base_url or "",
                response_id,
            ),
        )
        conn.execute(
            "DELETE FROM model_service_events WHERE created_at < datetime('now', '-30 days')"
        )


def get_model_monitor_snapshot(
    hours: int = 24,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    window_hours = min(max(hours, 1), 168)
    connection = get_model_connection(db_path)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    cutoff_text = cutoff.strftime("%Y-%m-%d %H:%M:%S")
    model_name = connection["model_name"]
    base_url = _normalize_base_url(connection["model_base_url"])

    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, request_kind, status, error_code, error_message,
                   latency_ms, total_tokens, model_name, base_url, created_at
            FROM model_service_events
            WHERE created_at >= ? AND model_name = ? AND base_url = ?
            ORDER BY id DESC
            """,
            (cutoff_text, model_name, base_url),
        ).fetchall()

    events = [row_to_dict(row) for row in rows]
    total = len(events)
    successful = sum(event["status"] == "success" for event in events)
    failed = total - successful
    success_rate = round(successful / total * 100, 1) if total else None
    latencies = sorted(
        int(event["latency_ms"])
        for event in events
        if event["status"] == "success"
    )
    average_latency = round(sum(latencies) / len(latencies)) if latencies else None
    p95_latency = (
        latencies[max(0, math.ceil(len(latencies) * 0.95) - 1)]
        if latencies
        else None
    )
    error_counts = Counter(
        event["error_code"] or "unknown_error"
        for event in events
        if event["status"] != "success"
    )
    consecutive_failures = 0
    for event in events:
        if event["status"] == "success":
            break
        consecutive_failures += 1

    status, status_message = _service_status(
        events=events,
        success_rate=success_rate,
        consecutive_failures=consecutive_failures,
    )
    last_success = next(
        (event["created_at"] for event in events if event["status"] == "success"),
        None,
    )
    last_check = next(
        (event["created_at"] for event in events if event["request_kind"] == "health_check"),
        None,
    )
    return {
        "status": status,
        "status_message": status_message,
        "model_name": model_name,
        "base_url": base_url,
        "api_key_configured": bool(connection["api_key"]),
        "window_hours": window_hours,
        "summary": {
            "total_requests": total,
            "successful_requests": successful,
            "failed_requests": failed,
            "success_rate": success_rate,
            "average_latency_ms": average_latency,
            "p95_latency_ms": p95_latency,
            "timeout_count": error_counts.get("request_timeout", 0),
            "consecutive_failures": consecutive_failures,
        },
        "error_breakdown": [
            {
                "code": code,
                "label": ERROR_LABELS.get(code, "其他异常"),
                "count": count,
            }
            for code, count in error_counts.most_common()
        ],
        "last_event_at": events[0]["created_at"] if events else None,
        "last_success_at": last_success,
        "last_check_at": last_check,
        "recent_events": events[:12],
    }


def _normalize_base_url(value: str | None) -> str:
    if not value:
        return ""
    normalized = value.rstrip("/")
    return normalized if normalized.endswith("/v1") else f"{normalized}/v1"


def _service_status(
    *,
    events: list[dict[str, Any]],
    success_rate: float | None,
    consecutive_failures: int,
) -> tuple[str, str]:
    if not events:
        return "unknown", "尚无调用记录，可点击“立即检测”验证连接"
    if consecutive_failures >= 2:
        return "unavailable", f"最近连续 {consecutive_failures} 次调用失败"
    if events[0]["status"] != "success":
        label = ERROR_LABELS.get(events[0]["error_code"], "调用异常")
        return "degraded", f"最近一次调用失败：{label}"
    if success_rate is not None and success_rate < 90:
        return "degraded", f"服务已恢复，但近期开启窗口内成功率为 {success_rate}%"
    return "healthy", "最近一次模型调用成功，服务运行正常"

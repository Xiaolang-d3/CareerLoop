"""Router fallback policy and per-profile capability records (schema v29).

Both are workspace data in SQLite.  The fallback policy feeds the LiteLLM
router; capability records hold manual overrides and the last live probe so
the capability report can merge: user override > live probe > LiteLLM data >
model-id heuristics.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import settings
from .model_capabilities import infer_vision


CAPABILITIES = ("vision", "tools", "reasoning", "structured_output", "pdf", "prompt_caching")
CAPABILITY_LABELS = {
    "vision": "视觉",
    "tools": "工具",
    "reasoning": "推理",
    "structured_output": "结构化输出",
    "pdf": "PDF",
    "prompt_caching": "缓存",
}
RETRY_KINDS = ("timeout", "rate_limit", "server_error")
DEFAULT_FALLBACK_POLICY: dict[str, Any] = {
    "enabled": False,
    "fallback_profile_ids": [],
    "context_window_profile_ids": [],
    "content_policy_profile_ids": [],
    "retry_policy": {"timeout": 0, "rate_limit": 0, "server_error": 0},
    "allowed_fails": 3,
    "cooldown_seconds": 60,
    "revision": 0,
}
_REASONING_HINTS = (
    "o1", "o3", "o4", "gpt-5", "reasoner", "deepseek-r1", "-r1", "qwq", "thinking",
    "claude-sonnet-4", "claude-opus-4", "claude-3-7", "gemini-2.5", "gemini-3", "grok-4", "grok-3-mini", "kimi-k2-thinking", "glm-4.5", "glm-4.6",
)


def connect(db_path):
    return settings.connect(db_path)


# ---------------------------------------------------------------------------
# Fallback policy
# ---------------------------------------------------------------------------

def _decode_policy(row: Any) -> dict[str, Any]:
    if row is None:
        return json.loads(json.dumps(DEFAULT_FALLBACK_POLICY))
    retry = {kind: 0 for kind in RETRY_KINDS} | {
        key: int(value) for key, value in json.loads(row["retry_policy_json"] or "{}").items() if key in RETRY_KINDS
    }
    return {
        "enabled": bool(row["enabled"]),
        "fallback_profile_ids": list(json.loads(row["fallback_profile_ids_json"] or "[]")),
        "context_window_profile_ids": list(json.loads(row["context_window_profile_ids_json"] or "[]")),
        "content_policy_profile_ids": list(json.loads(row["content_policy_profile_ids_json"] or "[]")),
        "retry_policy": retry,
        "allowed_fails": int(row["allowed_fails"]),
        "cooldown_seconds": int(row["cooldown_seconds"]),
        "revision": int(row["revision"]),
    }


def get_fallback_policy(db_path: str | Path | None = None) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM model_fallback_policy WHERE id = 1").fetchone()
        known = {item[0] for item in conn.execute("SELECT id FROM model_profiles")}
    policy = _decode_policy(row)
    # Profiles deleted after being chosen as fallbacks simply drop out.
    for key in ("fallback_profile_ids", "context_window_profile_ids", "content_policy_profile_ids"):
        policy[key] = [item for item in policy[key] if item in known]
    return policy


def _profile_ids(value: Any, field: str, known: set[str], *, limit: int) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError(f"{field} 需要为模型档案 ID 列表")
    result: list[str] = []
    for item in value:
        item = item.strip()
        if not item or item in result:
            continue
        if item not in known:
            raise ValueError("备用模型不存在，请刷新后重新选择")
        result.append(item)
    if len(result) > limit:
        raise ValueError(f"最多选择 {limit} 个备用模型")
    return result


def _bounded_int(value: Any, field: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{field} 需要为 {low} 到 {high} 之间的整数")
    return value


def save_fallback_policy(values: dict[str, Any], db_path: str | Path | None = None) -> dict[str, Any]:
    with connect(db_path) as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM model_fallback_policy WHERE id = 1").fetchone()
        current = _decode_policy(row)
        expected = values.get("expected_revision")
        if expected is not None and int(expected) != current["revision"]:
            raise settings.AgentSettingsConflict("备用模型设置已在其他页面更新，请重新读取后保存")
        known = {item[0] for item in conn.execute("SELECT id FROM model_profiles")}
        merged = {**current, **{key: value for key, value in values.items() if key in DEFAULT_FALLBACK_POLICY and key != "revision"}}
        retry_raw = merged.get("retry_policy") or {}
        if not isinstance(retry_raw, dict) or set(retry_raw) - set(RETRY_KINDS):
            raise ValueError("重试策略仅支持 timeout、rate_limit、server_error")
        retry = {kind: _bounded_int(retry_raw.get(kind, 0), f"{kind} 重试次数", 0, 3) for kind in RETRY_KINDS}
        policy = {
            "enabled": bool(merged.get("enabled")),
            "fallback_profile_ids": _profile_ids(merged.get("fallback_profile_ids"), "fallback_profile_ids", known, limit=5),
            "context_window_profile_ids": _profile_ids(merged.get("context_window_profile_ids"), "context_window_profile_ids", known, limit=2),
            "content_policy_profile_ids": _profile_ids(merged.get("content_policy_profile_ids"), "content_policy_profile_ids", known, limit=2),
            "retry_policy": retry,
            "allowed_fails": _bounded_int(merged.get("allowed_fails"), "允许失败次数", 1, 20),
            "cooldown_seconds": _bounded_int(merged.get("cooldown_seconds"), "冷却时间", 0, 3600),
            "revision": current["revision"] + 1,
        }
        conn.execute(
            """INSERT INTO model_fallback_policy (id, enabled, fallback_profile_ids_json, context_window_profile_ids_json,
                   content_policy_profile_ids_json, retry_policy_json, allowed_fails, cooldown_seconds, revision, updated_at)
               VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, fallback_profile_ids_json=excluded.fallback_profile_ids_json,
                   context_window_profile_ids_json=excluded.context_window_profile_ids_json,
                   content_policy_profile_ids_json=excluded.content_policy_profile_ids_json,
                   retry_policy_json=excluded.retry_policy_json, allowed_fails=excluded.allowed_fails,
                   cooldown_seconds=excluded.cooldown_seconds, revision=excluded.revision, updated_at=CURRENT_TIMESTAMP""",
            (
                int(policy["enabled"]), json.dumps(policy["fallback_profile_ids"]), json.dumps(policy["context_window_profile_ids"]),
                json.dumps(policy["content_policy_profile_ids"]), json.dumps(policy["retry_policy"], sort_keys=True),
                policy["allowed_fails"], policy["cooldown_seconds"], policy["revision"],
            ),
        )
    return policy


def policy_has_fallbacks(policy: dict[str, Any]) -> bool:
    return bool(policy.get("enabled")) and any(
        policy.get(key) for key in ("fallback_profile_ids", "context_window_profile_ids", "content_policy_profile_ids")
    )


# ---------------------------------------------------------------------------
# Capability records
# ---------------------------------------------------------------------------

def capability_records(profile_id: str, db_path: str | Path | None = None) -> dict[str, dict[str, dict[str, str]]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT capability, source, status, detail, updated_at FROM model_capability_records WHERE profile_id = ?",
            (profile_id,),
        ).fetchall()
    records: dict[str, dict[str, dict[str, str]]] = {"user": {}, "probe": {}}
    for row in rows:
        records[row["source"]][row["capability"]] = {"status": row["status"], "detail": row["detail"], "updated_at": row["updated_at"]}
    return records


def set_capability_record(
    profile_id: str, capability: str, status: str | None, *, source: str = "user", detail: str = "",
    db_path: str | Path | None = None,
) -> None:
    if capability not in CAPABILITIES:
        raise ValueError("未知模型能力")
    if source not in {"user", "probe"}:
        raise ValueError("未知能力来源")
    if status is not None and status not in {"supported", "unsupported"}:
        raise ValueError("能力状态需要为 supported、unsupported 或空值")
    with connect(db_path) as conn:
        if conn.execute("SELECT 1 FROM model_profiles WHERE id = ?", (profile_id,)).fetchone() is None:
            raise ValueError("模型档案不存在")
        if status is None:
            conn.execute(
                "DELETE FROM model_capability_records WHERE profile_id = ? AND capability = ? AND source = ?",
                (profile_id, capability, source),
            )
            return
        conn.execute(
            """INSERT INTO model_capability_records (profile_id, capability, source, status, detail, updated_at)
               VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(profile_id, capability, source) DO UPDATE SET status=excluded.status,
                   detail=excluded.detail, updated_at=CURRENT_TIMESTAMP""",
            (profile_id, capability, source, status, detail[:300]),
        )


def _heuristic(capability: str, model_name: str) -> dict[str, str] | None:
    if capability == "vision":
        flag = infer_vision(model_name)
        if flag["status"] != "unknown":
            return {"status": flag["status"], "detail": flag["detail"]}
        return None
    if capability == "reasoning":
        lowered = model_name.lower()
        if any(hint in lowered for hint in _REASONING_HINTS):
            return {"status": "supported", "detail": "按模型 ID 推测为推理模型"}
    return None


def merge_capabilities(
    *,
    model_name: str,
    litellm_data: dict[str, Any] | None,
    records: dict[str, dict[str, dict[str, str]]],
    context_limit: int | None = None,
) -> dict[str, Any]:
    """Merge with priority: user override > live probe > LiteLLM data > heuristics."""
    litellm_caps = (litellm_data or {}).get("capabilities") or {}
    merged: dict[str, Any] = {}
    for capability in CAPABILITIES:
        user = records.get("user", {}).get(capability)
        probe = records.get("probe", {}).get(capability)
        value = litellm_caps.get(capability)
        if user:
            entry = {"status": user["status"], "source": "user", "detail": "已手动设置"}
        elif probe:
            entry = {"status": probe["status"], "source": "probe", "detail": probe.get("detail") or "来自一次真实探测"}
        elif value is not None:
            entry = {"status": "supported" if value else "unsupported", "source": "litellm", "detail": "来自 LiteLLM 内置模型数据"}
        else:
            guess = _heuristic(capability, model_name)
            entry = {"status": guess["status"], "source": "heuristic", "detail": guess["detail"]} if guess else {
                "status": "unknown", "source": "none", "detail": "暂无可靠数据，可手动设置"}
        entry["label"] = CAPABILITY_LABELS[capability]
        entry["overridden"] = bool(user)
        entry["probe_status"] = probe["status"] if probe else None
        entry["litellm_status"] = None if value is None else ("supported" if value else "unsupported")
        merged[capability] = entry
    max_input = (litellm_data or {}).get("max_input_tokens")
    return {
        "capabilities": merged,
        "context_window": {
            "tokens": context_limit or max_input,
            "source": "user" if context_limit else "litellm" if max_input else "none",
        },
        "max_output_tokens": {
            "tokens": (litellm_data or {}).get("max_output_tokens"),
            "source": "litellm" if (litellm_data or {}).get("max_output_tokens") else "none",
        },
        "litellm_known": bool((litellm_data or {}).get("known")),
        "pricing": {
            "input_per_million_usd": _per_million((litellm_data or {}).get("input_cost_per_token")),
            "output_per_million_usd": _per_million((litellm_data or {}).get("output_cost_per_token")),
        },
    }


def _per_million(value: Any) -> float | None:
    return round(float(value) * 1_000_000, 6) if isinstance(value, (int, float)) else None


def profile_capability_report(profile_id: str, db_path: str | Path | None = None) -> dict[str, Any]:
    """Merged capability report for one saved profile (no network access)."""
    from .model_catalog import get_profile_connection
    from ..models.factory import model_backend

    connection = get_profile_connection(profile_id, db_path)
    protocol = connection.get("detected_protocol") or connection["resolved_model_protocol"]
    litellm_data = None
    if model_backend() == "litellm":
        from ..models.litellm_core import capability_defaults

        try:
            litellm_data = capability_defaults(protocol, connection["model_name"])
        except Exception:
            litellm_data = None
    report = merge_capabilities(
        model_name=connection["model_name"], litellm_data=litellm_data,
        records=capability_records(profile_id, db_path), context_limit=connection.get("context_limit"),
    )
    return {"profile_id": profile_id, "model_name": connection["model_name"], "protocol": protocol, **report}

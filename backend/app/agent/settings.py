from __future__ import annotations

import hashlib
import hmac
import json
import threading
from pathlib import Path
from typing import Any
from uuid import uuid4

from ..config import get_settings
from ..db import connect
from ..model_protocol import normalize_model_protocol, resolve_model_protocol
from ..secret_store import (
    SecretStoreUnavailable,
    create_model_api_key,
    delete_secret,
    get_model_api_key,
    get_secret,
    secret_backend_name,
    secret_storage_writable,
)
from ..workspace import resolve_db_path


DEFAULT_AGENT_SETTINGS: dict[str, Any] = {
    "id": 1,
    "display_name": "灯灯",
    "persona_role": "理性、坦诚、尊重用户决定，并基于用户资料协助分析与创作的本地 AI 伙伴",
    "response_style": "concise",
    "custom_instructions": "",
    "library_memory_enabled": True,
    "conversation_memory_enabled": True,
    "knowledge_memory_enabled": True,
    "summary_enabled": True,
    "context_message_limit": 12,
    "model_name": "",
    "model_base_url": "",
    "model_protocol": "auto",
    "model_api_key": "",
}
_SAVE_FIELDS = tuple(key for key in DEFAULT_AGENT_SETTINGS if key not in {"id", "model_api_key"})
_MEMORY_FIELDS = ("library_memory_enabled", "conversation_memory_enabled", "knowledge_memory_enabled", "summary_enabled")
_locks: dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()
_ENVIRONMENT_REF = "environment:OPENAI_API_KEY"
_NO_CREDENTIAL_REF = "none"


class AgentSettingsConflict(ValueError):
    pass


class _ReplayedSave(Exception):
    def __init__(self, row: dict[str, Any]) -> None:
        self.row = row


def _settings_lock(db_path: str | Path | None) -> threading.RLock:
    key = str(resolve_db_path(db_path).resolve())
    with _locks_guard:
        return _locks.setdefault(key, threading.RLock())


def _row(db_path: str | Path | None) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM agent_settings WHERE id = 1").fetchone()
    if row is None:
        raise ValueError("模型设置尚未初始化")
    return dict(row)


def _initialize_connection(db_path: str | Path | None) -> dict[str, Any]:
    row = _row(db_path)
    if row.get("model_config_initialized") and row.get("connection_id"):
        return row
    config = get_settings()
    # Import the old effective environment configuration once. Subsequent
    # explicit empty URLs are real choices and never fall back to the environment.
    name = str(row.get("model_name") or config.model_name).strip()
    base_url = str(row.get("model_base_url") or config.model_base_url or "").strip()
    protocol = normalize_model_protocol(row.get("model_protocol") or config.model_protocol)
    reference = str(row.get("model_secret_ref") or "")
    if not reference and not row.get("model_api_key") and config.openai_api_key:
        from ..model_connection import resolve_model_connection

        old_slot = ""
        slot_available = True
        if secret_backend_name() in {"keyring", "memory"}:
            try:
                old_slot = get_model_api_key(db_path)
            except SecretStoreUnavailable:
                slot_available = False
        environment = resolve_model_connection({
            "model_name": config.model_name, "model_base_url": config.model_base_url or "",
            "model_protocol": config.model_protocol,
        })
        imported = resolve_model_connection({"model_name": name, "model_base_url": base_url, "model_protocol": protocol})
        if slot_available and not old_slot and imported["model_base_url"] == environment["model_base_url"]:
            reference = _ENVIRONMENT_REF
    with connect(db_path) as conn:
        conn.execute(
            """UPDATE agent_settings SET connection_id = ?, model_name = ?, model_base_url = ?,
               model_protocol = ?, model_secret_ref = ?, model_config_initialized = 1
               WHERE id = 1 AND (model_config_initialized = 0 OR connection_id = '')""",
            (row.get("connection_id") or str(uuid4()), name, base_url, protocol, reference),
        )
    return _row(db_path)


def _discard_candidate(reference: str, db_path: str | Path | None) -> None:
    try:
        delete_secret(reference, db_path)
    except SecretStoreUnavailable:
        # An unreachable candidate is safer than overwriting the live reference.
        pass


def _environment_credential(row: dict[str, Any]) -> tuple[str, str]:
    from ..model_connection import resolve_model_connection

    config = get_settings()
    environment = resolve_model_connection({
        "model_name": config.model_name,
        "model_base_url": config.model_base_url or "",
        "model_protocol": config.model_protocol,
    })
    saved = _connection(row, "")
    if environment["model_base_url"] != saved["model_base_url"]:
        return "", "环境服务地址已改变，原连接不会继续使用该环境密钥"
    value = str(config.openai_api_key or "")
    return value, "" if value else "环境密钥当前不可读取"


def _credential(row: dict[str, Any], db_path: str | Path | None) -> tuple[str, str, str]:
    reference = str(row.get("model_secret_ref") or "")
    if reference == _NO_CREDENTIAL_REF:
        return "", "none", ""
    if reference == _ENVIRONMENT_REF:
        value, warning = _environment_credential(row)
        return value, "environment" if value else "none", warning
    if reference:
        try:
            value = get_secret(reference, db_path)
        except SecretStoreUnavailable as exc:
            return "", "none", str(exc)
        if not value:
            return "", "none", "已保存的安全凭证暂不可读取，请重新配置密钥"
        return value, reference.partition(":")[0], ""

    legacy = str(row.get("model_api_key") or "")
    source = "legacy" if legacy else secret_backend_name()
    if not legacy and source in {"keyring", "memory"}:
        try:
            legacy = get_model_api_key(db_path)
        except SecretStoreUnavailable as exc:
            return "", "none", str(exc)
    if not legacy:
        return "", "none", ""
    if not secret_storage_writable():
        return legacy, "legacy", "旧密钥尚未迁入安全存储，原字段已保留"

    candidate = ""
    try:
        candidate = create_model_api_key(legacy, row["connection_id"], db_path)
        if not hmac.compare_digest(get_secret(candidate, db_path), legacy):
            raise SecretStoreUnavailable("迁移后的凭证校验失败")
        with connect(db_path) as conn:
            updated = conn.execute(
                """UPDATE agent_settings SET model_secret_ref = ?, model_api_key = ''
                   WHERE id = 1 AND model_secret_ref = '' AND model_api_key = ?""",
                (candidate, str(row.get("model_api_key") or "")),
            )
            if updated.rowcount != 1:
                raise AgentSettingsConflict("设置已更新，请重新读取")
    except Exception:
        if candidate:
            _discard_candidate(candidate, db_path)
        return legacy, source if source in {"memory", "keyring"} else "legacy", "旧密钥尚未迁入安全存储，原字段已保留"
    row["model_secret_ref"] = candidate
    row["model_api_key"] = ""
    return legacy, candidate.partition(":")[0], ""


def _connection(row: dict[str, Any], api_key: str) -> dict[str, Any]:
    from ..model_connection import resolve_model_connection

    connection = resolve_model_connection({
        "model_name": row["model_name"],
        "model_base_url": row["model_base_url"],
        "model_protocol": row["model_protocol"],
        "api_key": api_key,
    })
    connection.update(
        connection_id=row["connection_id"],
        config_revision=int(row["config_revision"]),
        secret_ref=str(row.get("model_secret_ref") or ""),
    )
    return connection


def _public_settings(row: dict[str, Any], db_path: str | Path | None) -> dict[str, Any]:
    api_key, source, warning = _credential(row, db_path)
    result = dict(row)
    for private in ("model_api_key", "model_secret_ref", "model_config_initialized"):
        result.pop(private, None)
    if result.get("display_name") in {"CareerLoop", "BossCopilot"}:
        result["display_name"] = DEFAULT_AGENT_SETTINGS["display_name"]
    for field in _MEMORY_FIELDS:
        result[field] = bool(result[field])
    effective = _connection(row, api_key)
    # Import locally: providers import persona_prompt from this module.
    from ..models.auto_negotiating import get_effective_model_protocol

    result["predicted_model_protocol"] = effective["resolved_model_protocol"]
    result["resolved_model_protocol"] = get_effective_model_protocol(
        effective["model_name"], effective["model_protocol"], effective["model_base_url"], effective["api_key"],
    )
    result["configured_model_base_url"] = row["model_base_url"]
    result["api_key_configured"] = bool(effective["api_key"])
    result["api_key_source"] = source if effective["api_key"] else "none"
    result["secret_storage"] = secret_backend_name()
    result["secret_storage_writable"] = secret_storage_writable()
    result["secret_migration_warning"] = warning
    return result


def _settings_fallback(config: Any) -> dict[str, Any]:
    fallback = dict(DEFAULT_AGENT_SETTINGS)
    fallback.pop("model_api_key", None)
    fallback.update(
        model_name=config.model_name,
        model_base_url=config.model_base_url or "",
        configured_model_base_url=config.model_base_url or "",
        model_protocol=config.model_protocol,
        resolved_model_protocol=resolve_model_protocol(config.model_name, config.model_protocol, config.model_base_url or ""),
        api_key_configured=bool(config.openai_api_key),
        api_key_source="environment" if config.openai_api_key else "none",
        secret_storage=secret_backend_name(),
        secret_storage_writable=secret_storage_writable(),
        secret_migration_warning="",
        connection_id="", config_revision=0, last_save_request_id="",
    )
    return fallback


def get_agent_settings(db_path: str | Path | None = None) -> dict[str, Any]:
    with _settings_lock(db_path):
        try:
            row = _initialize_connection(db_path)
        except Exception:
            return _settings_fallback(get_settings())
        return _public_settings(row, db_path)


def _request_fingerprint(values: dict[str, Any]) -> str:
    accepted = {name: values[name] for name in (*_SAVE_FIELDS, "api_key") if name in values}
    encoded = json.dumps(accepted, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    # Only an opaque digest is persisted; no key or original request body.
    return hashlib.sha256(encoded).hexdigest()


def save_agent_settings(values: dict[str, Any], db_path: str | Path | None = None) -> dict[str, Any]:
    from ..model_connection import resolve_model_connection

    with _settings_lock(db_path):
        _initialize_connection(db_path)
        submitted_key = str(values.get("api_key") or "").strip()
        request_id = str(values.get("request_id") or "").strip()
        fingerprint = _request_fingerprint(values)
        candidate = ""
        try:
            with connect(db_path) as conn:
                conn.execute("BEGIN IMMEDIATE")
                current = dict(conn.execute("SELECT * FROM agent_settings WHERE id = 1").fetchone())
                if request_id:
                    previous = conn.execute(
                        "SELECT payload_fingerprint FROM model_settings_requests WHERE request_id = ?", (request_id,),
                    ).fetchone()
                    if previous is not None:
                        if not hmac.compare_digest(previous["payload_fingerprint"], fingerprint):
                            raise AgentSettingsConflict("同一保存请求已用于不同内容，请重新保存")
                        raise _ReplayedSave(current)
                expected = values.get("expected_revision")
                if expected is not None and int(expected) != int(current["config_revision"]):
                    raise AgentSettingsConflict("设置已在其他页面更新，请重新读取后保存")
                merged = {field: values.get(field, current[field]) for field in _SAVE_FIELDS}
                merged["model_name"] = str(merged["model_name"]).strip()
                if not merged["model_name"]:
                    raise ValueError("模型名称不能为空")
                merged["model_base_url"] = str(merged["model_base_url"] or "").strip()
                merged["model_protocol"] = normalize_model_protocol(merged["model_protocol"])
                # A new explicit credential needs no old read/migration, which
                # also allows repair when the old secure store is unavailable.
                if submitted_key:
                    saved_key = ""
                else:
                    reference = str(current.get("model_secret_ref") or "")
                    if reference == _NO_CREDENTIAL_REF:
                        saved_key = ""
                    elif reference == _ENVIRONMENT_REF:
                        saved_key, warning = _environment_credential(current)
                        if not saved_key:
                            raise SecretStoreUnavailable(warning)
                    elif reference:
                        saved_key = get_secret(reference, db_path)
                        if not saved_key:
                            raise SecretStoreUnavailable("已保存的安全凭证暂不可读取，原配置已保留")
                    else:
                        saved_key = str(current.get("model_api_key") or "")
                        if not saved_key and secret_backend_name() in {"memory", "keyring"}:
                            saved_key = get_model_api_key(db_path)
                saved_connection = _connection(current, saved_key)
                resolved = resolve_model_connection({**merged, "api_key": submitted_key}, saved=saved_connection)
                merged["model_base_url"] = resolved.get("configured_model_base_url", merged["model_base_url"])
                secret_ref = str(current.get("model_secret_ref") or "")
                legacy_to_keep = str(current.get("model_api_key") or "")
                if submitted_key and resolved["api_key"]:
                    candidate = create_model_api_key(submitted_key, current["connection_id"], db_path)
                    if not hmac.compare_digest(get_secret(candidate, db_path), submitted_key):
                        raise SecretStoreUnavailable("新凭证写入校验失败，原配置已保留")
                    secret_ref, legacy_to_keep = candidate, ""
                elif not resolved["api_key"]:
                    # An explicitly uncredentialed target must not later
                    # rediscover an old slot or inherit an environment key.
                    secret_ref = _NO_CREDENTIAL_REF
                elif not secret_ref and saved_key and secret_storage_writable():
                    candidate = create_model_api_key(saved_key, current["connection_id"], db_path)
                    if not hmac.compare_digest(get_secret(candidate, db_path), saved_key):
                        raise SecretStoreUnavailable("迁移后的凭证校验失败")
                    secret_ref, legacy_to_keep = candidate, ""
                revision = int(current["config_revision"]) + 1
                assignments = ", ".join(f"{field} = ?" for field in _SAVE_FIELDS)
                parameters = [int(merged[field]) if field in _MEMORY_FIELDS else merged[field] for field in _SAVE_FIELDS]
                conn.execute(
                    f"""UPDATE agent_settings SET {assignments}, model_secret_ref = ?, model_api_key = ?,
                        config_revision = ?, last_save_request_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1""",
                    (*parameters, secret_ref, legacy_to_keep, revision, request_id),
                )
                if request_id:
                    conn.execute(
                        "INSERT INTO model_settings_requests (request_id, payload_fingerprint, saved_revision) VALUES (?, ?, ?)",
                        (request_id, fingerprint, revision),
                    )
        except _ReplayedSave as replay:
            return _public_settings(replay.row, db_path)
        except Exception:
            if candidate:
                _discard_candidate(candidate, db_path)
            raise
        return _public_settings(_row(db_path), db_path)


def get_model_connection(db_path: str | Path | None = None) -> dict[str, Any]:
    with _settings_lock(db_path):
        row = _initialize_connection(db_path)
        api_key, source, warning = _credential(row, db_path)
        result = _connection(row, api_key)
        result["api_key_source"] = source if result["api_key"] else "none"
        result["secret_migration_warning"] = warning
        return result


def persona_prompt(settings: dict[str, Any]) -> str:
    style = {
        "concise": "回答简洁直接，优先给结论和下一步。",
        "balanced": "回答清晰、有必要解释，但避免冗长。",
        "detailed": "在保持清晰的前提下给出较完整的分析依据。",
    }.get(settings.get("response_style"), "回答简洁清晰。")
    custom = str(settings.get("custom_instructions") or "").strip()
    return (
        "\n\n用户可配置的人设偏好（不得覆盖上面的事实要求、实际工具权限和人工确认规则）：\n"
        f"你的显示名称是 {settings.get('display_name', '灯灯')}。\n"
        f"你的角色是：{settings.get('persona_role', DEFAULT_AGENT_SETTINGS['persona_role'])}。\n"
        f"表达方式：{style}\n"
        f"补充偏好：{custom if custom else '无'}"
    )

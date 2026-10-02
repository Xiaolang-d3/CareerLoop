from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

from .workspace import current_user_id, resolve_db_path


SERVICE_NAME = "com.careerloop.app"
_MEMORY_SECRETS: dict[str, str] = {}


class SecretStoreUnavailable(RuntimeError):
    pass


def _account_name(db_path: str | Path | None = None) -> str:
    user_id = current_user_id()
    if user_id is not None:
        return f"user:{user_id}:model-api-key"
    digest = hashlib.sha256(str(resolve_db_path(db_path).resolve()).encode("utf-8")).hexdigest()[:24]
    return f"workspace:{digest}:model-api-key"


def _backend() -> str:
    override = (os.getenv("CAREERLOOP_SECRET_BACKEND") or "").strip().lower()
    if override:
        return override
    if os.getenv("CAREERLOOP_DESKTOP", "false").lower() == "true" and sys.platform == "darwin":
        return "keyring"
    return "environment"


def get_model_api_key(db_path: str | Path | None = None) -> str:
    backend = _backend()
    account = _account_name(db_path)
    if backend == "memory":
        return _MEMORY_SECRETS.get(account, "")
    if backend == "keyring":
        try:
            import keyring

            return str(keyring.get_password(SERVICE_NAME, account) or "")
        except Exception as exc:
            raise SecretStoreUnavailable("无法读取 macOS 钥匙串") from exc
    return str(os.getenv("OPENAI_API_KEY") or "")


def set_model_api_key(value: str, db_path: str | Path | None = None) -> None:
    secret = value.strip()
    if not secret:
        return
    backend = _backend()
    account = _account_name(db_path)
    if backend == "memory":
        _MEMORY_SECRETS[account] = secret
        return
    if backend == "keyring":
        try:
            import keyring

            keyring.set_password(SERVICE_NAME, account, secret)
            return
        except Exception as exc:
            raise SecretStoreUnavailable("无法写入 macOS 钥匙串") from exc
    raise SecretStoreUnavailable(
        "当前环境没有可用的系统钥匙串；请通过 OPENAI_API_KEY 配置密钥"
    )


def secret_backend_name() -> str:
    return _backend()

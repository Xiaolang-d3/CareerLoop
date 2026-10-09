from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path
from uuid import uuid4

from .workspace import current_user_id, resolve_db_path


SERVICE_NAME = "com.careerloop.app"
_MEMORY_SECRETS: dict[str, str] = {}


class SecretStoreUnavailable(RuntimeError):
    pass


def _workspace_namespace(db_path: str | Path | None = None) -> str:
    # Distinguish installations whose numeric account IDs happen to be equal.
    digest = hashlib.sha256(str(resolve_db_path(db_path).resolve()).encode("utf-8")).hexdigest()[:24]
    return f"workspace:{digest}"


def _account_name(db_path: str | Path | None = None) -> str:
    """Old single-slot name, retained only for legacy migration."""
    user_id = current_user_id()
    if user_id is not None:
        return f"user:{user_id}:model-api-key"
    return f"{_workspace_namespace(db_path)}:model-api-key"


def _backend() -> str:
    override = (os.getenv("CAREERLOOP_SECRET_BACKEND") or "").strip().lower()
    if override:
        return override
    host = (os.getenv("BIND_HOST") or "127.0.0.1").strip().strip("[]")
    hosted = (os.getenv("CAREERLOOP_DEPLOYMENT_MODE") or "local").strip().lower() == "hosted"
    if sys.platform == "darwin" and not hosted and host in {"127.0.0.1", "localhost", "::1"}:
        return "keyring"
    return "environment"


def secret_storage_writable() -> bool:
    return _backend() in {"memory", "keyring"}


def _keyring_read(account: str) -> str:
    try:
        import keyring
        return str(keyring.get_password(SERVICE_NAME, account) or "")
    except Exception as exc:
        raise SecretStoreUnavailable("无法读取系统钥匙串") from exc


def get_model_api_key(db_path: str | Path | None = None) -> str:
    """Read the old slot or explicitly configured environment credential."""
    backend = _backend()
    account = _account_name(db_path)
    if backend == "memory":
        return _MEMORY_SECRETS.get(account, "")
    if backend == "keyring":
        return _keyring_read(account)
    return str(os.getenv("OPENAI_API_KEY") or "")


def _write(account: str, value: str, backend: str) -> None:
    if backend == "memory":
        _MEMORY_SECRETS[account] = value
        return
    if backend == "keyring":
        try:
            import keyring
            keyring.set_password(SERVICE_NAME, account, value)
            return
        except Exception as exc:
            raise SecretStoreUnavailable("无法写入系统钥匙串") from exc
    raise SecretStoreUnavailable(
        "当前部署使用只读环境密钥，无法在网页保存新密钥；"
        "本机可启用系统钥匙串，托管环境请配置安全凭证存储"
    )


def set_model_api_key(value: str, db_path: str | Path | None = None) -> None:
    """Compatibility writer. New configuration saves use immutable references."""
    secret = value.strip()
    if secret:
        _write(_account_name(db_path), secret, _backend())


def _reference_account(reference: str, db_path: str | Path | None) -> tuple[str, str]:
    backend, separator, account = reference.partition(":")
    namespace = _workspace_namespace(db_path)
    if not separator or backend not in {"memory", "keyring"} or not account.startswith(f"{namespace}:connection:"):
        raise SecretStoreUnavailable("凭证引用不属于当前工作区")
    return backend, account


def create_model_api_key(value: str, connection_id: str, db_path: str | Path | None = None) -> str:
    secret = value.strip()
    if not secret:
        raise ValueError("新密钥不能为空")
    backend = _backend()
    account = f"{_workspace_namespace(db_path)}:connection:{connection_id}:version:{uuid4()}"
    _write(account, secret, backend)
    return f"{backend}:{account}"


def get_secret(reference: str, db_path: str | Path | None = None) -> str:
    if not reference:
        return ""
    backend, account = _reference_account(reference, db_path)
    if backend != _backend():
        raise SecretStoreUnavailable("当前安全存储与已保存凭证不匹配")
    if backend == "memory":
        return _MEMORY_SECRETS.get(account, "")
    return _keyring_read(account)


def delete_secret(reference: str, db_path: str | Path | None = None) -> None:
    if not reference:
        return
    backend, account = _reference_account(reference, db_path)
    if backend == "memory":
        _MEMORY_SECRETS.pop(account, None)
        return
    try:
        import keyring
        keyring.delete_password(SERVICE_NAME, account)
    except Exception as exc:
        raise SecretStoreUnavailable("无法删除候选系统凭证") from exc


def secret_backend_name() -> str:
    return _backend()

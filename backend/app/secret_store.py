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
    hosted = (os.getenv("CAREERLOOP_DEPLOYMENT_MODE") or "local").strip().lower() == "hosted"
    if hosted and os.getenv("CAREERLOOP_SECRET_MASTER_KEY"):
        return "encrypted"
    # Listening on a LAN interface does not change where local credentials live.
    if sys.platform == "darwin" and not hosted:
        return "keyring"
    return "environment"


def secret_storage_writable() -> bool:
    if _backend() == "encrypted":
        try:
            _fernet()
        except SecretStoreUnavailable:
            return False
        return True
    return _backend() in {"memory", "keyring"}


def _fernet():
    try:
        from cryptography.fernet import Fernet
        return Fernet((os.getenv("CAREERLOOP_SECRET_MASTER_KEY") or "").encode("ascii"))
    except (ValueError, UnicodeError, ImportError) as exc:
        raise SecretStoreUnavailable("服务器密钥存储未正确配置") from exc


def _encrypted_path(account: str, db_path: str | Path | None) -> Path:
    # The validated account is a storage identifier, never a path supplied by a user.
    return resolve_db_path(db_path).parent / ".model-secrets" / hashlib.sha256(account.encode()).hexdigest()


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


def _write(account: str, value: str, backend: str, db_path: str | Path | None = None) -> None:
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
    if backend == "encrypted":
        cipher = _fernet().encrypt(value.encode("utf-8"))
        path = _encrypted_path(account, db_path)
        try:
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(cipher)
        except OSError as exc:
            raise SecretStoreUnavailable("无法保存加密模型凭证") from exc
        return
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
    if not separator or backend not in {"memory", "keyring", "encrypted"} or not account.startswith(f"{namespace}:connection:"):
        raise SecretStoreUnavailable("凭证引用不属于当前工作区")
    return backend, account


def secret_reference_backend(reference: str, db_path: str | Path | None = None) -> str:
    """Validate a saved reference without unlocking or reading the keychain."""
    backend, _ = _reference_account(reference, db_path)
    if backend != _backend():
        raise SecretStoreUnavailable("当前安全存储与已保存凭证不匹配")
    return backend


def create_model_api_key(value: str, connection_id: str, db_path: str | Path | None = None) -> str:
    secret = value.strip()
    if not secret:
        raise ValueError("新密钥不能为空")
    backend = _backend()
    account = f"{_workspace_namespace(db_path)}:connection:{connection_id}:version:{uuid4()}"
    _write(account, secret, backend, db_path)
    return f"{backend}:{account}"


def get_secret(reference: str, db_path: str | Path | None = None) -> str:
    if not reference:
        return ""
    backend, account = _reference_account(reference, db_path)
    if backend != _backend():
        raise SecretStoreUnavailable("当前安全存储与已保存凭证不匹配")
    if backend == "memory":
        return _MEMORY_SECRETS.get(account, "")
    if backend == "encrypted":
        from cryptography.fernet import InvalidToken
        try:
            return _fernet().decrypt(_encrypted_path(account, db_path).read_bytes()).decode("utf-8")
        except (OSError, InvalidToken, UnicodeError) as exc:
            raise SecretStoreUnavailable("无法读取加密模型凭证，请检查服务器密钥和备份") from exc
    return _keyring_read(account)


def delete_secret(reference: str, db_path: str | Path | None = None) -> None:
    if not reference:
        return
    backend, account = _reference_account(reference, db_path)
    if backend == "memory":
        _MEMORY_SECRETS.pop(account, None)
        return
    if backend == "encrypted":
        try:
            _encrypted_path(account, db_path).unlink(missing_ok=True)
        except OSError as exc:
            raise SecretStoreUnavailable("无法删除加密模型凭证") from exc
        return
    try:
        import keyring
        keyring.delete_password(SERVICE_NAME, account)
    except Exception as exc:
        raise SecretStoreUnavailable("无法删除候选系统凭证") from exc


def secret_backend_name() -> str:
    return _backend()

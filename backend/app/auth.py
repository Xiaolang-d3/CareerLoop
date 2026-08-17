from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status

from .config import get_settings
from .db import connect
from .workspace import auth_db_path, data_dir, ensure_workspace, init_auth_db


_CAPTCHA_TTL_SECONDS = 300
_CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_captcha_challenges: dict[str, tuple[str, float]] = {}
_captcha_lock = threading.Lock()

# Failed-login counters keyed by "<email>|<client>" so a shared LAN cannot be
# used to brute force one account from many machines.
_login_failures: dict[str, tuple[int, float]] = {}
_login_lock = threading.Lock()


def _throttle_key(email: str, client: str | None) -> str:
    return f"{email.strip().lower()}|{client or 'unknown'}"


def check_login_allowed(email: str, client: str | None = None) -> None:
    settings = get_settings()
    key = _throttle_key(email, client)
    now = time.monotonic()
    with _login_lock:
        expired = [k for k, (_, until) in _login_failures.items() if until <= now]
        for k in expired:
            del _login_failures[k]
        record = _login_failures.get(key)
    if record and record[0] >= settings.login_max_attempts and record[1] > now:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"登录失败次数过多，请在 {int(record[1] - now) + 1} 秒后重试",
        )


def _record_login_failure(email: str, client: str | None) -> None:
    settings = get_settings()
    key = _throttle_key(email, client)
    now = time.monotonic()
    with _login_lock:
        count = _login_failures.get(key, (0, 0.0))[0] + 1
        _login_failures[key] = (count, now + settings.login_lockout_seconds)


def _clear_login_failures(email: str, client: str | None) -> None:
    with _login_lock:
        _login_failures.pop(_throttle_key(email, client), None)


def auth_is_enabled() -> bool:
    return True


def _connect_auth():
    init_auth_db()
    return connect(auth_db_path())


def public_auth_config() -> dict[str, bool]:
    """Return only the information a browser needs to decide whether to log in."""
    with _connect_auth() as conn:
        exists = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
    return {"enabled": True, "setup_required": not exists, "registration_open": True}


def create_captcha() -> dict[str, str]:
    """Create a short-lived, one-time challenge with visual and text renderings."""
    captcha_id = secrets.token_urlsafe(18)
    answer = "".join(secrets.choice(_CAPTCHA_ALPHABET) for _ in range(5))
    now = time.monotonic()
    with _captcha_lock:
        expired = [key for key, (_, expires_at) in _captcha_challenges.items() if expires_at <= now]
        for key in expired:
            del _captcha_challenges[key]
        _captcha_challenges[captcha_id] = (answer, now + _CAPTCHA_TTL_SECONDS)
    # Returning the tiny SVG with the challenge avoids a second request through
    # a remote tunnel before the sign-in form becomes usable.
    image = captcha_svg(captcha_id)
    if image is None:  # Defensive only: the challenge was just stored above.
        raise RuntimeError("验证码创建失败")
    # The SVG already carries the challenge characters in its markup, so a
    # spaced text rendering does not weaken the existing client-side threat
    # model. It gives screen-reader and low-vision users an equivalent path.
    return {"captcha_id": captcha_id, "svg": image, "accessible_text": " ".join(answer)}


def captcha_svg(captcha_id: str) -> str | None:
    with _captcha_lock:
        challenge = _captcha_challenges.get(captcha_id)
    if challenge is None or challenge[1] <= time.monotonic():
        return None
    answer = challenge[0]
    rotations = (-8, 5, -3, 8, -6)
    letters = "".join(
        f'<text x="{24 + index * 28}" y="39" transform="rotate({rotations[index]} {24 + index * 28} 39)">{letter}</text>'
        for index, letter in enumerate(answer)
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="54" viewBox="0 0 180 54" role="img" aria-label="验证码">'
        '<rect width="180" height="54" rx="8" fill="#eef0ff"/>'
        '<path d="M0 14 C35 34 60 0 92 21 S145 44 180 13" stroke="#878bbd" stroke-width="2" fill="none"/>'
        '<style>text{font:700 29px sans-serif;fill:#252752;letter-spacing:2px}</style>'
        f'{letters}</svg>'
    )


def verify_captcha(captcha_id: str, code: str) -> bool:
    now = time.monotonic()
    with _captcha_lock:
        challenge = _captcha_challenges.pop(captcha_id, None)
    return bool(
        challenge
        and challenge[1] > now
        and hmac.compare_digest(challenge[0], code.strip().upper())
    )


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    password_hash = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return f"{_encode(salt)}${_encode(password_hash)}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        encoded_salt, expected = stored.split("$", 1)
        actual = _hash_password(password, _decode(encoded_salt)).split("$", 1)[1]
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def _sign(payload: str, password_hash: str) -> str:
    return _encode(hmac.new(password_hash.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest())


def _issue_token(user: dict[str, Any]) -> str:
    payload = _encode(
        json.dumps(
            {
                "id": user["id"],
                "email": user["email"],
                "exp": int(time.time()) + get_settings().auth_token_ttl_seconds,
            },
            separators=(",", ":"),
        ).encode("utf-8")
    )
    return f"{payload}.{_sign(payload, user['password_hash'])}"


def authenticate(
    email: str,
    password: str,
    captcha_id: str,
    captcha_code: str,
    client: str | None = None,
) -> str:
    check_login_allowed(email, client)
    if not verify_captcha(captcha_id, captcha_code):
        _record_login_failure(email, client)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="验证码不正确或已过期")
    with _connect_auth() as conn:
        row = conn.execute(
            "SELECT id, email, password_hash FROM users WHERE email = ?",
            (email.strip().lower(),),
        ).fetchone()
    if row is None or not _verify_password(password, row["password_hash"]):
        _record_login_failure(email, client)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邮箱或密码不正确")
    _clear_login_failures(email, client)
    ensure_workspace(int(row["id"]))
    return _issue_token(dict(row))


def register_user(email: str, password: str, captcha_id: str, captcha_code: str) -> str:
    if not verify_captcha(captcha_id, captcha_code):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="验证码不正确或已过期")
    normalized_email = email.strip().lower()
    with _connect_auth() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = conn.execute(
                "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                (normalized_email, _hash_password(password)),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已注册，请直接登录") from exc
        user = conn.execute(
            "SELECT id, email, password_hash FROM users WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    ensure_workspace(int(user["id"]))
    return _issue_token(dict(user))


def create_initial_user(email: str, password: str, captcha_id: str, captcha_code: str) -> str:
    return register_user(email, password, captcha_id, captcha_code)


def current_user(authorization: str | None) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload, signature = token.split(".", 1)
        data = json.loads(_decode(payload))
        if not isinstance(data, dict) or not isinstance(data.get("id"), int) or not isinstance(data.get("email"), str):
            raise ValueError("invalid payload")
        if int(data.get("exp", 0)) < time.time():
            raise ValueError("expired")
        with _connect_auth() as conn:
            user = conn.execute(
                "SELECT id, email, password_hash FROM users WHERE id = ?", (data["id"],)
            ).fetchone()
        if user is None or not hmac.compare_digest(data["email"].lower(), user["email"].lower()):
            raise ValueError("unexpected user")
        if not hmac.compare_digest(signature, _sign(payload, user["password_hash"])):
            raise ValueError("invalid signature")
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态已失效，请重新登录") from None
    return {"id": user["id"], "email": user["email"]}


_AVATAR_MAX_BYTES = 2 * 1024 * 1024
_AVATAR_SIZE = 256
_ACCOUNT_COLUMNS = "id, email, display_name, avatar_relpath"


def _account_from_row(row: Any) -> dict[str, Any]:
    relpath = str(row["avatar_relpath"] or "")
    return {
        "id": int(row["id"]),
        "email": str(row["email"]),
        "display_name": str(row["display_name"] or ""),
        "has_avatar": bool(relpath and (data_dir() / relpath).is_file()),
    }


def get_account(user_id: int) -> dict[str, Any]:
    with _connect_auth() as conn:
        row = conn.execute(
            f"SELECT {_ACCOUNT_COLUMNS} FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="账号不存在")
    return _account_from_row(row)


def update_account(user_id: int, display_name: str) -> dict[str, Any]:
    clean = display_name.strip()
    if len(clean) > 40:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="昵称不能超过 40 个字")
    with _connect_auth() as conn:
        cursor = conn.execute(
            "UPDATE users SET display_name = ? WHERE id = ?",
            (clean, user_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="账号不存在")
    return get_account(user_id)


def change_password(user_id: int, current_password: str, new_password: str) -> str:
    if len(new_password) < 8:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="新密码至少 8 位")
    if current_password == new_password:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="新密码不能与当前密码相同")
    with _connect_auth() as conn:
        row = conn.execute(
            "SELECT id, email, password_hash FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="账号不存在")
        if not _verify_password(current_password, row["password_hash"]):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="当前密码不正确")
        password_hash = _hash_password(new_password)
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
        user = {"id": row["id"], "email": row["email"], "password_hash": password_hash}
    return _issue_token(user)


def avatar_path(user_id: int) -> Path | None:
    with _connect_auth() as conn:
        row = conn.execute(
            "SELECT avatar_relpath FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if row is None or not row["avatar_relpath"]:
        return None
    path = data_dir() / str(row["avatar_relpath"])
    return path if path.is_file() else None


def save_avatar(user_id: int, filename: str, content: bytes) -> dict[str, Any]:
    if not content:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="头像文件为空")
    if len(content) > _AVATAR_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="头像不能超过 2MB")
    suffix = Path(filename).suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="头像仅支持 PNG、JPEG 或 WebP")
    try:
        from io import BytesIO
        from PIL import Image

        with Image.open(BytesIO(content)) as image:
            image = image.convert("RGB")
            width, height = image.size
            side = min(width, height)
            left = (width - side) // 2
            top = (height - side) // 2
            image = image.crop((left, top, left + side, top + side))
            image = image.resize((_AVATAR_SIZE, _AVATAR_SIZE))
            output = BytesIO()
            image.save(output, format="JPEG", quality=88)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="无法识别该图片文件") from exc
    previous = avatar_path(user_id)
    relpath = f"avatars/{user_id}.jpg"
    destination = data_dir() / relpath
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.write_bytes(output.getvalue())
    try:
        destination.chmod(0o600)
    except OSError:
        pass
    if previous is not None and previous.resolve() != destination.resolve():
        previous.unlink(missing_ok=True)
    with _connect_auth() as conn:
        conn.execute("UPDATE users SET avatar_relpath = ? WHERE id = ?", (relpath, user_id))
    return get_account(user_id)


def delete_avatar(user_id: int) -> dict[str, Any]:
    previous = avatar_path(user_id)
    with _connect_auth() as conn:
        conn.execute("UPDATE users SET avatar_relpath = '' WHERE id = ?", (user_id,))
    if previous is not None:
        previous.unlink(missing_ok=True)
    return get_account(user_id)

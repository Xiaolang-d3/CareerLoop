from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from typing import Any

from fastapi import HTTPException, status

from .config import get_settings
from .db import connect


_CAPTCHA_TTL_SECONDS = 300
_CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_captcha_challenges: dict[str, tuple[str, float]] = {}
_captcha_lock = threading.Lock()

# Failed-login counters keyed by "<email>|<client>" so a shared LAN cannot be
# used to brute force the single local account.
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


def public_auth_config() -> dict[str, bool]:
    """Return only the information a browser needs to decide whether to log in."""
    with connect() as conn:
        exists = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None
    return {"enabled": True, "setup_required": not exists}


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
    with connect() as conn:
        row = conn.execute(
            "SELECT id, email, password_hash FROM users WHERE email = ?",
            (email.strip().lower(),),
        ).fetchone()
    if row is None or not _verify_password(password, row["password_hash"]):
        _record_login_failure(email, client)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邮箱或密码不正确")
    _clear_login_failures(email, client)
    return _issue_token(dict(row))


def create_initial_user(email: str, password: str, captcha_id: str, captcha_code: str) -> str:
    if not verify_captcha(captcha_id, captcha_code):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="验证码不正确或已过期")
    normalized_email = email.strip().lower()
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="管理员账户已经创建，请直接登录")
        cursor = conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, ?)",
            (normalized_email, _hash_password(password)),
        )
        user = conn.execute(
            "SELECT id, email, password_hash FROM users WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return _issue_token(dict(user))


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
        with connect() as conn:
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

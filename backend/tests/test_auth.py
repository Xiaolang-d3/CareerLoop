from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth
from app import db
from app.config import get_settings
from app.main import app


@pytest.fixture(autouse=True)
def isolated_auth_database(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "auth.db")
    db.init_db()
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_authentication_issues_and_validates_signed_token() -> None:
    auth.create_initial_user("owner@example.com", "a-long-test-password")

    token = auth.authenticate("OWNER@example.com", "a-long-test-password")

    assert auth.current_user(f"Bearer {token}") == {"id": 1, "email": "owner@example.com"}


def test_authentication_rejects_wrong_password() -> None:
    auth.create_initial_user("owner@example.com", "a-long-test-password")
    try:
        auth.authenticate("owner@example.com", "wrong-password")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401
    else:
        raise AssertionError("wrong password must be rejected")


def test_auth_protects_business_routes() -> None:
    client = TestClient(app)

    assert client.get("/library").status_code == 401
    bootstrap = client.post(
        "/auth/bootstrap",
        json={"email": "owner@example.com", "password": "a-long-test-password"},
    )
    assert bootstrap.status_code == 200
    login = client.post(
        "/auth/login",
        json={"email": "owner@example.com", "password": "a-long-test-password"},
    )

    assert login.status_code == 200
    assert client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    ).json() == {"user": {"id": 1, "email": "owner@example.com", "display_name": "", "has_avatar": False}}


def test_register_creates_a_second_user() -> None:
    client = TestClient(app)
    assert client.post(
        "/auth/register",
        json={"email": "owner@example.com", "password": "a-long-test-password"},
    ).status_code == 200
    created = client.post(
        "/auth/register",
        json={"email": "second@example.com", "password": "another-long-password"},
    )
    assert created.status_code == 200
    assert created.json()["user"] == {"id": 2, "email": "second@example.com", "display_name": "", "has_avatar": False}


def test_register_rejects_duplicate_email() -> None:
    client = TestClient(app)
    client.post(
        "/auth/register",
        json={"email": "owner@example.com", "password": "a-long-test-password"},
    ).raise_for_status()
    conflict = client.post(
        "/auth/register",
        json={"email": "OWNER@example.com", "password": "another-long-password"},
    )
    assert conflict.status_code == 409
    assert "已注册" in conflict.json()["detail"]
    assert client.post("/auth/login", json={"email": "owner@example.com", "password": "a-long-test-password"}).status_code == 200
    assert client.post("/auth/login", json={"email": "owner@example.com", "password": "another-long-password"}).status_code == 401


def test_login_distinguishes_unregistered_email_without_creating_an_account() -> None:
    client = TestClient(app)
    unknown = client.post("/auth/login", json={"email": " New@Example.com ", "password": "a-long-test-password"})
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == "该邮箱尚未注册"
    with auth._connect_auth() as conn:
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 0
    created = client.post("/auth/register", json={"email": " New@Example.com ", "password": "a-long-test-password"})
    assert created.status_code == 200
    headers = {"Authorization": f"Bearer {created.json()['access_token']}"}
    assert client.get("/auth/me", headers=headers).json()["user"]["email"] == "new@example.com"
    wrong = client.post("/auth/login", json={"email": "new@example.com", "password": "wrong"})
    assert wrong.status_code == 401
    assert wrong.json()["detail"] == "密码不正确"


def test_unregistered_login_attempts_are_still_throttled() -> None:
    client = TestClient(app)
    for _ in range(get_settings().login_max_attempts):
        assert client.post("/auth/login", json={"email": "unknown@example.com", "password": "wrong"}).status_code == 404
    blocked = client.post("/auth/login", json={"email": "unknown@example.com", "password": "wrong"})
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) == get_settings().login_lockout_seconds


def test_auth_config_stays_open_after_first_user() -> None:
    client = TestClient(app)
    empty = client.get("/auth/config").json()
    assert empty["setup_required"] is True
    assert empty["registration_open"] is True
    client.post(
        "/auth/register",
        json={"email": "owner@example.com", "password": "a-long-test-password"},
    ).raise_for_status()
    filled = client.get("/auth/config").json()
    assert filled["setup_required"] is False
    assert filled["registration_open"] is True


def _register(client: TestClient, email: str = "owner@example.com", password: str = "a-long-test-password") -> str:
    created = client.post(
        "/auth/register",
        json={"email": email, "password": password},
    )
    created.raise_for_status()
    return created.json()["access_token"]


def test_account_nickname_follows_the_signed_in_user() -> None:
    client = TestClient(app)
    token = _register(client)
    headers = {"Authorization": f"Bearer {token}"}

    updated = client.patch("/auth/me", json={"display_name": "  小林  "}, headers=headers)
    assert updated.status_code == 200
    assert updated.json()["user"] == {
        "id": 1,
        "email": "owner@example.com",
        "display_name": "小林",
        "has_avatar": False,
    }
    assert client.get("/auth/me", headers=headers).json()["user"]["display_name"] == "小林"

    too_long = client.patch("/auth/me", json={"display_name": "字" * 41}, headers=headers)
    assert too_long.status_code == 422


def test_account_password_change_issues_a_new_token() -> None:
    client = TestClient(app)
    old_token = _register(client)
    old_headers = {"Authorization": f"Bearer {old_token}"}

    rejected = client.post(
        "/auth/me/password",
        json={"current_password": "wrong-password", "new_password": "brand-new-password"},
        headers=old_headers,
    )
    assert rejected.status_code == 422
    assert client.get("/auth/me", headers=old_headers).status_code == 200

    same = client.post(
        "/auth/me/password",
        json={"current_password": "a-long-test-password", "new_password": "a-long-test-password"},
        headers=old_headers,
    )
    assert same.status_code == 422

    changed = client.post(
        "/auth/me/password",
        json={"current_password": "a-long-test-password", "new_password": "brand-new-password"},
        headers=old_headers,
    )
    assert changed.status_code == 200
    new_token = changed.json()["access_token"]
    assert new_token != old_token
    assert client.get("/auth/me", headers=old_headers).status_code == 401
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {new_token}"}).json()["user"]["email"] == "owner@example.com"

    login = client.post(
        "/auth/login",
        json={"email": "owner@example.com", "password": "brand-new-password"},
    )
    assert login.status_code == 200


def test_account_avatar_is_private_to_the_signed_in_user() -> None:
    from io import BytesIO

    from PIL import Image

    client = TestClient(app)
    token = _register(client)
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/auth/me/avatar", headers=headers).status_code == 404

    buffer = BytesIO()
    Image.new("RGB", (40, 24), color=(80, 90, 200)).save(buffer, format="PNG")
    uploaded = client.post(
        "/auth/me/avatar",
        files={"file": ("face.png", buffer.getvalue(), "image/png")},
        headers=headers,
    )
    assert uploaded.status_code == 200
    assert uploaded.json()["user"]["has_avatar"] is True

    avatar = client.get("/auth/me/avatar", headers=headers)
    assert avatar.status_code == 200
    assert avatar.headers["content-type"] == "image/jpeg"
    assert avatar.content[:2] == b"\xff\xd8"

    other_token = _register(client, "other@example.com", "another-long-password")
    assert client.get("/auth/me/avatar", headers={"Authorization": f"Bearer {other_token}"}).status_code == 404

    removed = client.delete("/auth/me/avatar", headers=headers)
    assert removed.status_code == 200
    assert removed.json()["user"]["has_avatar"] is False
    assert client.get("/auth/me/avatar", headers=headers).status_code == 404

@pytest.mark.parametrize("email", ["invalid", "a@localhost", "a b@example.com", "a@@example.com", "a@example.com\nother", "x" * 321 + "@example.com"])
def test_register_checks_email_on_server_and_service(email: str) -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as rejected:
        auth.register_user(email, "a-long-test-password")
    assert rejected.value.status_code == 422
    client = TestClient(app)
    assert client.post("/auth/register", json={"email": email, "password": "a-long-test-password"}).status_code == 422
    assert auth.public_auth_config()["setup_required"] is True


@pytest.mark.parametrize("email, normalized", [
    ("  用户@Example.com  ", "用户@example.com"),
    ("😀" * 314 + "@x.com", "😀" * 314 + "@x.com"),
])
def test_normalized_and_unicode_email_can_sign_in(email: str, normalized: str) -> None:
    token = auth.register_user(email, "a-long-test-password")
    assert auth.current_user(f"bearer {token}")["email"] == normalized
    assert auth.current_user(f"Bearer {auth.authenticate(normalized.upper(), 'a-long-test-password')}")["id"] == 1


def test_bootstrap_only_creates_the_first_account() -> None:
    client = TestClient(app)
    first = client.post("/auth/bootstrap", json={"email": "first@example.com", "password": "a-long-test-password"})
    assert first.status_code == 200
    later = client.post("/auth/bootstrap", json={"email": "second@example.com", "password": "a-long-test-password"})
    assert later.status_code == 409
    assert client.post("/auth/register", json={"email": "second@example.com", "password": "a-long-test-password"}).status_code == 200


def test_logout_revokes_only_the_current_session_and_never_stores_tokens() -> None:
    client = TestClient(app)
    first = _register(client)
    second = auth.authenticate("owner@example.com", "a-long-test-password")
    assert first != second
    first_headers = {"Authorization": f"Bearer {first}"}
    second_headers = {"Authorization": f"Bearer {second}"}
    result = client.post("/auth/logout", headers=first_headers)
    assert result.status_code == 204
    assert result.content == b""
    assert result.headers["cache-control"] == "no-store"
    assert client.get("/auth/me", headers=first_headers).status_code == 401
    assert client.get("/auth/me", headers=second_headers).status_code == 200
    assert client.post("/auth/logout", headers=first_headers).status_code == 401
    with auth._connect_auth() as conn:
        sessions = conn.execute("SELECT token_hash, revoked_at FROM auth_sessions").fetchall()
    assert len(sessions) == 2
    assert all(row["token_hash"] not in {first, second} and len(row["token_hash"]) == 64 for row in sessions)


def _signed_payload(payload: dict) -> str:
    import json

    with auth._connect_auth() as conn:
        user = conn.execute("SELECT password_hash FROM users WHERE id = 1").fetchone()
    encoded = auth._encode(json.dumps(payload).encode())
    return f"{encoded}.{auth._sign(encoded, user['password_hash'])}"


def test_existing_token_is_adopted_and_can_be_revoked() -> None:
    import time
    from fastapi import HTTPException

    auth.register_user("owner@example.com", "a-long-test-password")
    token = _signed_payload({"id": 1, "email": "owner@example.com", "exp": int(time.time()) + 300})
    assert auth.current_user(f"Bearer {token}")["id"] == 1
    auth.revoke_session(f"Bearer {token}")
    with pytest.raises(HTTPException) as rejected:
        auth.current_user(f"Bearer {token}")
    assert rejected.value.status_code == 401


@pytest.mark.parametrize("overrides", [
    {"exp": None}, {"exp": []}, {"exp": {}}, {"exp": "99999999999"}, {"exp": True},
    {"id": True}, {"id": -1}, {"email": None}, {"sid": ""}, {"sid": []}, {"sid": "unregistered-session"},
])
def test_malformed_signed_claims_return_401(overrides: dict) -> None:
    import time

    auth.register_user("owner@example.com", "a-long-test-password")
    token = _signed_payload({"id": 1, "email": "owner@example.com", "exp": int(time.time()) + 300, **overrides})
    response = TestClient(app).get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("token", ["garbage", "a.b.c", "☃.☃", "e30.☃", "x" * 8193])
def test_malformed_bearer_tokens_never_crash(token: str) -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as rejected:
        auth.current_user(f"Bearer {token}")
    assert rejected.value.status_code == 401


def test_expired_session_is_rejected_and_cleaned_on_next_login(monkeypatch) -> None:
    from fastapi import HTTPException

    clock = [1000]
    monkeypatch.setattr(auth.time, "time", lambda: clock[0])
    token = auth.register_user("owner@example.com", "a-long-test-password")
    clock[0] += get_settings().auth_token_ttl_seconds
    with pytest.raises(HTTPException) as expired:
        auth.current_user(f"Bearer {token}")
    assert expired.value.status_code == 401
    auth.authenticate("owner@example.com", "a-long-test-password")
    with auth._connect_auth() as conn:
        assert conn.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0] == 1


def test_lockout_exposes_retry_after_and_expires(monkeypatch) -> None:
    monkeypatch.setenv("LOGIN_MAX_ATTEMPTS", "2")
    clock = [1000]
    monkeypatch.setattr(auth.time, "time", lambda: clock[0])
    client = TestClient(app)
    _register(client)
    for _ in range(2):
        assert client.post("/auth/login", json={"email": "owner@example.com", "password": "wrong"}).status_code == 401
    blocked = client.post("/auth/login", json={"email": "owner@example.com", "password": "a-long-test-password"})
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) == get_settings().login_lockout_seconds
    clock[0] += get_settings().login_lockout_seconds
    assert client.post("/auth/login", json={"email": "owner@example.com", "password": "a-long-test-password"}).status_code == 200


def test_password_change_is_throttled_without_invalidating_session(monkeypatch) -> None:
    monkeypatch.setenv("LOGIN_MAX_ATTEMPTS", "2")
    client = TestClient(app)
    token = _register(client)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"current_password": "wrong", "new_password": "a-new-test-password"}
    for _ in range(2):
        assert client.post("/auth/me/password", json=payload, headers=headers).status_code == 422
    assert client.post("/auth/me/password", json=payload, headers=headers).status_code == 429
    assert client.get("/auth/me", headers=headers).status_code == 200


def test_legacy_short_password_is_allowed_at_login() -> None:
    auth.init_auth_db()
    with auth._connect_auth() as conn:
        conn.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", ("old-local-name", auth._hash_password("old")))
    result = TestClient(app).post("/auth/login", json={"email": "old-local-name", "password": "old"})
    assert result.status_code == 200



def test_password_change_detects_concurrent_update(monkeypatch) -> None:
    from fastapi import HTTPException

    token = auth.register_user("owner@example.com", "a-long-test-password")
    original = auth._hash_password
    competing_hash = original("competing-password")

    def replace_password(password, salt=None):
        with auth._connect_auth() as conn:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = 1", (competing_hash,))
        return original(password, salt)

    monkeypatch.setattr(auth, "_hash_password", replace_password)
    monkeypatch.setattr(auth, "_verify_password", lambda password, stored: True)
    with pytest.raises(HTTPException) as conflict:
        auth.change_password(1, "a-long-test-password", "a-new-test-password")
    assert conflict.value.status_code == 409
    with pytest.raises(HTTPException):
        auth.current_user(f"Bearer {token}")
    with auth._connect_auth() as conn:
        assert conn.execute("SELECT password_hash FROM users WHERE id = 1").fetchone()[0] == competing_hash


def test_avatar_rejects_other_account_paths_and_oversized_dimensions() -> None:
    import struct
    import zlib
    from io import BytesIO
    from PIL import Image

    client = TestClient(app)
    token = _register(client)
    headers = {"Authorization": f"Bearer {token}"}
    outside = db.DB_PATH.parent / "private.jpg"
    outside.write_bytes(b"private bytes")
    with auth._connect_auth() as conn:
        conn.execute("UPDATE users SET avatar_relpath = 'private.jpg' WHERE id = 1")
    assert client.get("/auth/me/avatar", headers=headers).status_code == 404
    assert client.get("/auth/me", headers=headers).json()["user"]["has_avatar"] is False
    assert client.delete("/auth/me/avatar", headers=headers).status_code == 200
    assert outside.read_bytes() == b"private bytes"
    buffer = BytesIO()
    Image.new("RGB", (1, 1)).save(buffer, format="PNG")
    content = bytearray(buffer.getvalue())
    content[16:24] = struct.pack(">II", 4001, 4000)
    content[29:33] = struct.pack(">I", zlib.crc32(content[12:29]))
    rejected = client.post("/auth/me/avatar", files={"file": ("huge.png", bytes(content), "image/png")}, headers=headers)
    assert rejected.status_code == 422
    assert "像素" in rejected.json()["detail"]


def test_avatar_delete_failure_preserves_database_state(monkeypatch) -> None:
    from pathlib import Path

    auth.register_user("owner@example.com", "a-long-test-password")
    root = db.DB_PATH.parent / "avatars"
    root.mkdir()
    avatar = root / "1.jpg"
    avatar.write_bytes(b"avatar")
    with auth._connect_auth() as conn:
        conn.execute("UPDATE users SET avatar_relpath = 'avatars/1.jpg' WHERE id = 1")
    original = Path.unlink

    def fail_avatar(path, *args, **kwargs):
        if path == avatar:
            raise PermissionError("synthetic permission failure")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_avatar)
    with pytest.raises(PermissionError):
        auth.delete_avatar(1)
    assert auth.get_account(1)["has_avatar"] is True


@pytest.mark.parametrize("password", ["short", "x" * 7, "x" * 129, "😀" * 7, "e\u0301" * 7, "passwordpassword", "password", "12345678", "new@example.com"])
def test_registration_password_policy_is_enforced_in_service(password: str) -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as rejected:
        auth.register_user("new@example.com", password)
    assert rejected.value.status_code == 422
    assert auth.public_auth_config()["setup_required"] is True


@pytest.mark.parametrize("password", ["x" * 7, "x" * 129, "passwordpassword", "PASSWORD", "12345678", "owner@example.com"])
def test_register_and_password_change_enforce_the_same_policy(password: str) -> None:
    client = TestClient(app)
    assert client.post("/auth/register", json={"email": "owner@example.com", "password": password}).status_code == 422
    token = _register(client)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/auth/me/password", headers=headers, json={"current_password": "a-long-test-password", "new_password": password})
    assert response.status_code == 422
    assert client.get("/auth/me", headers=headers).status_code == 200


@pytest.mark.parametrize("password", ["mV!8kP2z", "rkt9876543!", "x" * 128, "😀" * 8, "a phrase with spaces", "密码passwordpassword并非完整弱密码"])
def test_password_policy_allows_valid_length_unicode_and_phrase_passwords(password: str) -> None:
    token = auth.register_user("owner@example.com", password)
    assert auth.current_user(f"Bearer {token}")["id"] == 1
    assert auth.current_user(f"Bearer {auth.authenticate('owner@example.com', password)}")["id"] == 1


def test_password_change_accepts_an_eleven_character_password() -> None:
    client = TestClient(app)
    token = _register(client)
    password = "rkt9876543!"
    response = client.post("/auth/me/password", headers={"Authorization": f"Bearer {token}"}, json={"current_password": "a-long-test-password", "new_password": password})
    assert response.status_code == 200
    assert client.post("/auth/login", json={"email": "owner@example.com", "password": password}).status_code == 200


def test_new_password_hashes_normalize_unicode_without_trimming_spaces() -> None:
    password = "e\u0301" * 15
    auth.register_user("owner@example.com", password)
    assert auth.current_user(f"Bearer {auth.authenticate('owner@example.com', 'é' * 15)}")["id"] == 1
    stored = auth._hash_password("  a phrase with spaces  ")
    assert auth._verify_password("  a phrase with spaces  ", stored)
    assert not auth._verify_password("a phrase with spaces", stored)


def test_unversioned_password_hashes_keep_their_original_byte_semantics() -> None:
    import hashlib
    salt = b"0123456789abcdef"
    password = "e\u0301" * 8
    stored = f"{auth._encode(salt)}${auth._encode(hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1))}"
    assert auth._verify_password(password, stored)
    assert not auth._verify_password("é" * 8, stored)


def test_bootstrap_is_atomic_across_concurrent_requests() -> None:
    from concurrent.futures import ThreadPoolExecutor
    from fastapi import HTTPException

    auth.init_auth_db()

    def initialize(email):
        try:
            auth.create_initial_user(email, "a-long-test-password")
            return 200
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(initialize, ["first@example.com", "second@example.com"]))
    assert sorted(results) == [200, 409]
    with auth._connect_auth() as conn:
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1


def test_unknown_email_still_runs_the_password_verifier(monkeypatch) -> None:
    from fastapi import HTTPException
    from unittest.mock import Mock

    verify = Mock(return_value=False)
    monkeypatch.setattr(auth, "_verify_password", verify)
    with pytest.raises(HTTPException) as rejected:
        auth.authenticate("unknown@example.com", "wrong-password")
    assert rejected.value.status_code == 404
    assert rejected.value.detail == "该邮箱尚未注册"
    verify.assert_called_once_with("wrong-password", auth._DUMMY_PASSWORD_HASH)

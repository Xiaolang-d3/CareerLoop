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


def test_authentication_issues_and_validates_signed_token(monkeypatch) -> None:
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    captcha = auth.create_captcha()
    auth.create_initial_user("owner@example.com", "a-long-test-password", captcha["captcha_id"], "AAAAA")
    captcha = auth.create_captcha()

    token = auth.authenticate("OWNER@example.com", "a-long-test-password", captcha["captcha_id"], "AAAAA")

    assert auth.current_user(f"Bearer {token}") == {"id": 1, "email": "owner@example.com"}


def test_authentication_rejects_wrong_password(monkeypatch) -> None:
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    captcha = auth.create_captcha()
    auth.create_initial_user("owner@example.com", "a-long-test-password", captcha["captcha_id"], "AAAAA")
    captcha = auth.create_captcha()
    try:
        auth.authenticate("owner@example.com", "wrong-password", captcha["captcha_id"], "AAAAA")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401
    else:
        raise AssertionError("wrong password must be rejected")


def test_captcha_is_case_insensitive_and_one_time(monkeypatch) -> None:
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    captcha = auth.create_captcha()

    assert auth.verify_captcha(captcha["captcha_id"], "aaaaa") is True
    assert auth.verify_captcha(captcha["captcha_id"], "AAAAA") is False


def test_captcha_payload_includes_its_svg(monkeypatch) -> None:
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")

    captcha = auth.create_captcha()

    assert captcha["svg"].startswith("<svg")
    assert captcha["svg"].count(">A</text>") == 5
    assert captcha["accessible_text"] == "A A A A A"


def test_auth_protects_business_routes(monkeypatch) -> None:
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    client = TestClient(app)

    assert client.get("/jobs").status_code == 401
    captcha = client.get("/auth/captcha").json()
    bootstrap = client.post(
        "/auth/bootstrap",
        json={"email": "owner@example.com", "password": "a-long-test-password", "captcha_id": captcha["captcha_id"], "captcha_code": "AAAAA"},
    )
    assert bootstrap.status_code == 200
    captcha = client.get("/auth/captcha").json()
    login = client.post(
        "/auth/login",
        json={"email": "owner@example.com", "password": "a-long-test-password", "captcha_id": captcha["captcha_id"], "captcha_code": "AAAAA"},
    )

    assert login.status_code == 200
    assert client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
    ).json() == {"user": {"id": 1, "email": "owner@example.com", "display_name": "", "has_avatar": False}}


def test_register_creates_a_second_user(monkeypatch) -> None:
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    client = TestClient(app)
    first = client.get("/auth/captcha").json()
    assert client.post(
        "/auth/register",
        json={
            "email": "owner@example.com",
            "password": "a-long-test-password",
            "captcha_id": first["captcha_id"],
            "captcha_code": "AAAAA",
        },
    ).status_code == 200
    second = client.get("/auth/captcha").json()
    created = client.post(
        "/auth/register",
        json={
            "email": "second@example.com",
            "password": "another-long-password",
            "captcha_id": second["captcha_id"],
            "captcha_code": "AAAAA",
        },
    )
    assert created.status_code == 200
    assert created.json()["user"] == {"id": 2, "email": "second@example.com", "display_name": "", "has_avatar": False}


def test_register_rejects_duplicate_email(monkeypatch) -> None:
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    client = TestClient(app)
    first = client.get("/auth/captcha").json()
    client.post(
        "/auth/register",
        json={
            "email": "owner@example.com",
            "password": "a-long-test-password",
            "captcha_id": first["captcha_id"],
            "captcha_code": "AAAAA",
        },
    ).raise_for_status()
    second = client.get("/auth/captcha").json()
    conflict = client.post(
        "/auth/register",
        json={
            "email": "OWNER@example.com",
            "password": "another-long-password",
            "captcha_id": second["captcha_id"],
            "captcha_code": "AAAAA",
        },
    )
    assert conflict.status_code == 409
    assert "已注册" in conflict.json()["detail"]


def test_auth_config_stays_open_after_first_user(monkeypatch) -> None:
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    client = TestClient(app)
    empty = client.get("/auth/config").json()
    assert empty["setup_required"] is True
    assert empty["registration_open"] is True
    captcha = client.get("/auth/captcha").json()
    client.post(
        "/auth/register",
        json={
            "email": "owner@example.com",
            "password": "a-long-test-password",
            "captcha_id": captcha["captcha_id"],
            "captcha_code": "AAAAA",
        },
    ).raise_for_status()
    filled = client.get("/auth/config").json()
    assert filled["setup_required"] is False
    assert filled["registration_open"] is True


def _register(client: TestClient, email: str = "owner@example.com", password: str = "a-long-test-password") -> str:
    captcha = client.get("/auth/captcha").json()
    created = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": password,
            "captcha_id": captcha["captcha_id"],
            "captcha_code": "AAAAA",
        },
    )
    created.raise_for_status()
    return created.json()["access_token"]


def test_account_nickname_follows_the_signed_in_user(monkeypatch) -> None:
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
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


def test_account_password_change_issues_a_new_token(monkeypatch) -> None:
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    client = TestClient(app)
    old_token = _register(client)
    old_headers = {"Authorization": f"Bearer {old_token}"}

    rejected = client.post(
        "/auth/me/password",
        json={"current_password": "wrong-password", "new_password": "brand-new-password"},
        headers=old_headers,
    )
    assert rejected.status_code == 401

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

    captcha = client.get("/auth/captcha").json()
    login = client.post(
        "/auth/login",
        json={
            "email": "owner@example.com",
            "password": "brand-new-password",
            "captcha_id": captcha["captcha_id"],
            "captcha_code": "AAAAA",
        },
    )
    assert login.status_code == 200


def test_account_avatar_is_private_to_the_signed_in_user(monkeypatch) -> None:
    from io import BytesIO

    from PIL import Image

    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
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

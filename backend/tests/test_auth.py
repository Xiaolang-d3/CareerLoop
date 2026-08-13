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
    ).json() == {"user": {"id": 1, "email": "owner@example.com"}}

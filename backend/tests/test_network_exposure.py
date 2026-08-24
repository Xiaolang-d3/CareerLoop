from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth, db
from app.config import Settings, get_settings
from app.main import FRONTEND_DIST_DIR, app, static_asset_cache_control


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "exposure.db")
    db.init_db()
    get_settings.cache_clear()
    auth._login_failures.clear()
    yield
    get_settings.cache_clear()
    auth._login_failures.clear()


def test_defaults_stay_on_loopback_with_docs_open(monkeypatch) -> None:
    for key in ("BIND_HOST", "PUBLIC_HOSTS", "ALLOWED_ORIGINS", "API_DOCS_ENABLED"):
        monkeypatch.delenv(key, raising=False)

    settings = get_settings()

    assert settings.bind_host == "127.0.0.1"
    assert settings.is_loopback_only is True
    assert settings.api_docs_enabled is True
    assert settings.allowed_origins == [
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
        "http://localhost:5173",
        "http://localhost:4173",
    ]


def test_exposed_bind_closes_docs_and_adds_named_origins(monkeypatch) -> None:
    monkeypatch.setenv("BIND_HOST", "0.0.0.0")
    monkeypatch.setenv("PUBLIC_HOSTS", "192.168.1.3")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("API_DOCS_ENABLED", raising=False)

    settings = get_settings()

    assert settings.is_loopback_only is False
    # Docs describe every route, so exposure must not leak them by default.
    assert settings.api_docs_enabled is False
    assert "http://192.168.1.3:5173" in settings.allowed_origins
    assert "http://127.0.0.1:5173" in settings.allowed_origins


def test_unlisted_origin_is_not_allowed(monkeypatch) -> None:
    monkeypatch.setenv("BIND_HOST", "0.0.0.0")
    monkeypatch.setenv("PUBLIC_HOSTS", "192.168.1.3")

    origins = get_settings().allowed_origins

    assert "http://192.168.1.99:5173" not in origins
    assert "http://evil.example.com" not in origins


def test_explicit_allowed_origins_are_honoured(monkeypatch) -> None:
    monkeypatch.delenv("BIND_HOST", raising=False)
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://careerloop.example.com")

    assert "https://careerloop.example.com" in get_settings().allowed_origins


def test_login_locks_out_after_repeated_failures(monkeypatch) -> None:
    monkeypatch.setenv("LOGIN_MAX_ATTEMPTS", "3")
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    captcha = auth.create_captcha()
    auth.create_initial_user("owner@example.com", "a-long-test-password", captcha["captcha_id"], "AAAAA")

    for _ in range(3):
        captcha = auth.create_captcha()
        with pytest.raises(Exception) as failure:
            auth.authenticate("owner@example.com", "wrong-password", captcha["captcha_id"], "AAAAA", client="192.168.1.9")
        assert getattr(failure.value, "status_code", None) == 401

    captcha = auth.create_captcha()
    with pytest.raises(Exception) as locked:
        auth.authenticate("owner@example.com", "a-long-test-password", captcha["captcha_id"], "AAAAA", client="192.168.1.9")
    assert getattr(locked.value, "status_code", None) == 429


def test_lockout_is_scoped_per_client(monkeypatch) -> None:
    monkeypatch.setenv("LOGIN_MAX_ATTEMPTS", "2")
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    captcha = auth.create_captcha()
    auth.create_initial_user("owner@example.com", "a-long-test-password", captcha["captcha_id"], "AAAAA")

    for _ in range(2):
        captcha = auth.create_captcha()
        with pytest.raises(Exception):
            auth.authenticate("owner@example.com", "wrong", captcha["captcha_id"], "AAAAA", client="192.168.1.9")

    captcha = auth.create_captcha()
    token = auth.authenticate(
        "owner@example.com", "a-long-test-password", captcha["captcha_id"], "AAAAA", client="127.0.0.1"
    )

    assert auth.current_user(f"Bearer {token}")["email"] == "owner@example.com"


def test_successful_login_clears_failure_counter(monkeypatch) -> None:
    monkeypatch.setenv("LOGIN_MAX_ATTEMPTS", "3")
    monkeypatch.setattr(auth.secrets, "choice", lambda _: "A")
    captcha = auth.create_captcha()
    auth.create_initial_user("owner@example.com", "a-long-test-password", captcha["captcha_id"], "AAAAA")

    captcha = auth.create_captcha()
    with pytest.raises(Exception):
        auth.authenticate("owner@example.com", "wrong", captcha["captcha_id"], "AAAAA", client="10.0.0.5")
    captcha = auth.create_captcha()
    auth.authenticate("owner@example.com", "a-long-test-password", captcha["captcha_id"], "AAAAA", client="10.0.0.5")

    assert auth._throttle_key("owner@example.com", "10.0.0.5") not in auth._login_failures


def test_loopback_detection_covers_ipv6() -> None:
    assert Settings(bind_host="::1").is_loopback_only is True
    assert Settings(bind_host="0.0.0.0").is_loopback_only is False


def test_only_content_hashed_frontend_assets_receive_immutable_cache_policy() -> None:
    assert static_asset_cache_control("/assets/index-abc123.js") == "public, max-age=31536000, immutable"
    assert static_asset_cache_control("/") is None
    assert static_asset_cache_control("/auth/captcha") is None


def test_public_brand_asset_path_bypasses_login() -> None:
    client = TestClient(app)

    response = client.get("/careerloop-mark-v2.png")
    expected_status = 200 if (FRONTEND_DIST_DIR / "careerloop-mark-v2.png").is_file() else 404
    assert response.status_code == expected_status
    # careerloop-mark.svg 已随品牌切换移除；白名单不应再放行不存在的文件。
    assert client.get("/careerloop-mark.svg").status_code == 401

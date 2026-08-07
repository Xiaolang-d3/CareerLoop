from fastapi.testclient import TestClient

from app.main import app


def test_browser_extension_preflight_is_allowed() -> None:
    response = TestClient(app).options(
        "/opportunities/browser-detail-import",
        headers={
            "Origin": "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    )

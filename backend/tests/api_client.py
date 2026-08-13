from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient


def create_authenticated_client(app: FastAPI) -> TestClient:
    """Create a client through the same bootstrap flow used by the UI."""
    client = TestClient(app)
    captcha_response = client.get("/auth/captcha")
    captcha_response.raise_for_status()
    captcha = captcha_response.json()
    response = client.post(
        "/auth/bootstrap",
        json={
            "email": "test-owner@example.com",
            "password": "a-long-test-password",
            "captcha_id": captcha["captcha_id"],
            "captcha_code": captcha["accessible_text"].replace(" ", ""),
        },
    )
    response.raise_for_status()
    client.headers["Authorization"] = f"Bearer {response.json()['access_token']}"
    return client

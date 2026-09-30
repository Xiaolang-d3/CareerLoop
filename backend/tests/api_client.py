from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient


def register_authenticated_client(
    app: FastAPI,
    email: str = "test-owner@example.com",
    password: str = "a-long-test-password",
    endpoint: str = "/auth/register",
) -> TestClient:
    """Create a client through the same register/bootstrap flow used by the UI."""
    client = TestClient(app)
    response = client.post(
        endpoint,
        json={"email": email, "password": password},
    )
    response.raise_for_status()
    client.headers["Authorization"] = f"Bearer {response.json()['access_token']}"
    return client


def create_authenticated_client(app: FastAPI) -> TestClient:
    """Create a client through the same bootstrap flow used by the UI."""
    return register_authenticated_client(app, endpoint="/auth/bootstrap")

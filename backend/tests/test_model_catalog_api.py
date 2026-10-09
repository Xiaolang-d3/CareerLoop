"""Public contracts across independent model services; all credentials are fake."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app import db, secret_store
from app.agent import settings
from app.api import model
from app.db import init_db
from app.main import app
from api_client import create_authenticated_client


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "catalog.db")
    monkeypatch.setattr(settings, "get_settings", lambda: SimpleNamespace(
        model_name="initial-model", model_base_url=None, model_protocol="auto", openai_api_key=None,
    ))
    monkeypatch.setattr(secret_store, "_MEMORY_SECRETS", {})
    init_db()
    authenticated = create_authenticated_client(app)
    yield authenticated
    authenticated.close()


def create(client, name, key):
    response = client.post("/agent/model-connections", json={
        "name": name, "model_base_url": f"https://{name}.example.test/v1",
        "model_protocol": "openai", "api_key": key, "model_name": "shared-model-name",
    })
    assert response.status_code == 200, response.text
    catalog = response.json()
    connection = next(item for item in catalog["connections"] if item["name"] == name)
    profile = next(item for item in catalog["profiles"] if item["connection_id"] == connection["id"])
    assert "api_key" not in connection and "secret_ref" not in connection
    assert key not in response.text
    return catalog, connection, profile


def test_connections_and_profiles_do_not_silently_change_default(client):
    original = client.get("/agent/model-connections").json()["default_profile_id"]
    catalog, first, profile = create(client, "first", "synthetic-first-key")
    assert catalog["default_profile_id"] == original
    response = client.post("/agent/model-profiles", json={"connection_id": first["id"], "model_name": "second-model"})
    assert response.status_code == 200
    assert len([item for item in response.json()["profiles"] if item["connection_id"] == first["id"]]) == 2
    changed = client.post("/agent/model-default", json={"profile_id": profile["id"]})
    assert changed.status_code == 200
    saved = client.get("/agent/settings").json()
    assert saved["model_name"] == "shared-model-name" and saved["model_base_url"] == first["model_base_url"]
    assert saved["api_key_configured"] is True


def test_saved_connection_discovery_uses_its_own_key(client, monkeypatch):
    _catalog, first, _profile = create(client, "first", "synthetic-first-key")
    create(client, "second", "synthetic-second-key")
    provider = SimpleNamespace(name="openai", models_url="https://first.example.test/v1/models", list_models=AsyncMock(return_value=["another-model"]))
    factory = Mock(return_value=provider)
    monkeypatch.setattr(model, "build_model_provider", factory)
    response = client.post(f"/agent/model-connections/{first['id']}/discover")
    assert response.status_code == 200
    assert factory.call_args.kwargs["api_key"] == "synthetic-first-key"
    assert factory.call_args.kwargs["base_url"] == first["model_base_url"]


def test_connection_edit_preserves_credentials_and_rejects_stale_revision(client):
    _catalog, connection, _profile = create(client, "first", "synthetic-first-key")
    address = {"model_base_url": "https://changed.example.test/v1", "expected_revision": connection["revision"], "api_key": ""}
    assert client.patch(f"/agent/model-connections/{connection['id']}", json=address).status_code == 400
    renamed = client.patch(f"/agent/model-connections/{connection['id']}", json={"name": "renamed", "expected_revision": connection["revision"]})
    assert renamed.status_code == 200
    assert client.patch(f"/agent/model-connections/{connection['id']}", json={"name": "stale", "expected_revision": connection["revision"]}).status_code == 409


def test_default_archive_is_rejected_and_conversation_selection_can_reset(client):
    _catalog, first, profile = create(client, "first", "synthetic-first-key")
    client.post("/agent/model-default", json={"profile_id": profile["id"]})
    assert client.delete(f"/agent/model-connections/{first['id']}").status_code == 400
    conversation = client.post("/conversations", json={"title": "model selection"}).json()
    selected = client.patch(f"/conversations/{conversation['id']}", json={"model_profile_id": profile["id"]})
    assert selected.status_code == 200 and selected.json()["model_profile_id"] == profile["id"]
    renamed = client.patch(f"/conversations/{conversation['id']}", json={"title": "same selection"})
    assert renamed.json()["model_profile_id"] == profile["id"]
    reset = client.patch(f"/conversations/{conversation['id']}", json={"model_profile_id": None})
    assert reset.json()["model_profile_id"] is None
    assert client.patch(f"/conversations/{conversation['id']}", json={"model_profile_id": "foreign-profile"}).status_code == 400


def test_ag_ui_model_profile_type_is_validated_before_run(client):
    conversation = client.post("/conversations", json={"title": "validation"}).json()
    response = client.post("/ag-ui", json={
        "threadId": str(conversation["id"]), "runId": "invalid-profile", "messages": [{"id": "message", "role": "user", "content": "hello"}],
        "tools": [], "context": [], "state": {}, "forwardedProps": {"modelProfileId": 42},
    })
    assert response.status_code == 422

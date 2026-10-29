"""Purpose settings share connections and never advertise unsupported adapters."""
import pytest

from test_model_catalog_api import client  # noqa: F401
from app.agent.model_purposes import model_output_types, supported_purposes


def shared_models(client):
    result = client.post("/agent/model-connections", json={
        "name": "shared", "model_base_url": "https://shared.example.test/v1", "api_key": "synthetic-key", "model_protocol": "auto",
    }).json()
    source = next(item for item in result["connections"] if item["name"] == "shared")
    profiles = {}
    for name in ("gpt-4.1", "gpt-image-2", "sora-2", "private-alias"):
        response = client.post("/agent/model-profiles", json={"connection_id": source["id"], "model_name": name})
        assert response.status_code == 200, response.text
        profiles[name] = next(item for item in response.json()["profiles"] if item["model_name"] == name)
    return source, profiles


def choose(client, kind, profile_id, version=None):
    if version is None:
        version = client.get("/agent/model-connections").json()["purpose_version"]
    return client.post(f"/agent/model-defaults/{kind}", json={"profile_id": profile_id, "expected_version": version})


def test_shared_provider_has_independent_defaults_and_conflict_protection(client):
    source, profiles = shared_models(client)
    initial = client.get("/agent/model-connections").json()
    assert choose(client, "image", profiles["gpt-image-2"]["id"]).status_code == 200
    assert choose(client, "chat", profiles["gpt-4.1"]["id"], initial["purpose_version"]).status_code == 409
    response = choose(client, "chat", profiles["gpt-4.1"]["id"])
    assert response.status_code == 200
    result = response.json()
    assert result["purpose_defaults"] == {"chat": profiles["gpt-4.1"]["id"], "image": profiles["gpt-image-2"]["id"]}
    assert result["default_profile_id"] == profiles["gpt-4.1"]["id"]
    assert "synthetic-key" not in response.text
    assert choose(client, "chat", profiles["sora-2"]["id"]).status_code == 400
    assert choose(client, "image", profiles["gpt-4.1"]["id"]).status_code == 400
    assert choose(client, "video", profiles["sora-2"]["id"]).status_code == 400
    assert all(item["connection_id"] == source["id"] for item in profiles.values())


def test_default_dependency_blocks_disable_and_incompatible_capability_change(client):
    source, profiles = shared_models(client)
    choose(client, "chat", profiles["gpt-4.1"]["id"])
    image = profiles["gpt-image-2"]
    choose(client, "image", image["id"])
    path = f'/agent/model-profiles/{image["id"]}'
    assert client.patch(path, json={"enabled": False, "expected_revision": image["revision"]}).status_code == 400
    assert client.patch(path, json={"capabilities": {"image_generation": "unsupported"}, "expected_revision": image["revision"]}).status_code == 400
    assert choose(client, "image", None).status_code == 200
    assert client.patch(path, json={"enabled": False, "expected_revision": image["revision"]}).status_code == 200
    assert choose(client, "image", image["id"]).status_code == 400


def test_stage_edits_keep_purpose_defaults_and_unknown_alias_can_be_confirmed(client):
    _, profiles = shared_models(client)
    unknown = profiles["private-alias"]
    assert unknown["output_types"] == []
    assert choose(client, "chat", unknown["id"]).status_code == 400
    update = client.patch(f'/agent/model-profiles/{unknown["id"]}', json={"expected_revision": unknown["revision"], "capabilities": {"chat": "supported"}})
    assert update.status_code == 200
    assert choose(client, "chat", unknown["id"]).status_code == 200
    policy = client.get("/agent/model-routing").json()
    response = client.put("/agent/model-routing", json={"roles": {}, "expected_version": policy["version"]})
    assert response.status_code == 200
    assert client.get("/agent/model-connections").json()["purpose_defaults"]["chat"] == unknown["id"]


@pytest.mark.parametrize("name,types", [("gpt-4.1", ["chat"]), ("gpt-image-2", ["image"]), ("sora-2", ["video"]), ("private-alias", []), ("grok-4.7", ["chat", "image"])])
def test_output_detection_and_adapter_support_are_separate(name, types):
    profile = {"model_name": name, "capabilities": {}}
    source = {"protocol": "auto", "effective_base_url": "https://shared.example.test/v1"}
    assert model_output_types(profile, source)[0] == types
    assert "video" not in supported_purposes(profile, source)
    if name == "gpt-4.1":
        profile["capabilities"] = {"vision": "supported"}
        assert model_output_types(profile, source)[0] == ["chat"]


def test_identified_image_adapter_is_not_assumed_for_arbitrary_generator():
    profile = {"model_name": "flux.1-dev", "capabilities": {}}
    source = {"protocol": "auto"}
    assert model_output_types(profile, source)[0] == ["image"]
    assert supported_purposes(profile, source) == []


def test_single_service_inherits_legacy_default_and_retains_historical_connections(client):
    initial = client.get("/agent/model-connections").json()
    old_default = next(profile for profile in initial["profiles"] if profile["id"] == initial["default_profile_id"])
    inherited_service = old_default["connection_id"]
    assert initial["service_connection_id"] == inherited_service

    source, profiles = shared_models(client)
    before = client.get("/agent/model-connections").json()
    changed = client.post("/agent/model-default", json={"profile_id": profiles["gpt-4.1"]["id"]})
    assert changed.status_code == 200, changed.text
    after = client.get("/agent/model-connections").json()

    assert after["default_profile_id"] == profiles["gpt-4.1"]["id"]
    assert source["id"] != inherited_service
    assert after["service_connection_id"] == inherited_service
    assert {connection["id"] for connection in after["connections"]} == {connection["id"] for connection in before["connections"]}
    assert {profile["id"] for profile in after["profiles"]} == {profile["id"] for profile in before["profiles"]}
    assert all(connection["enabled"] for connection in after["connections"])

import pytest

from app.model_connection import normalize_api_root, resolve_model_connection


SAVED = {
    "model_name": "gpt-test", "model_protocol": "auto",
    "model_base_url": "https://gateway.test/tenant/v1", "api_key": "fake-old-key",
}


@pytest.mark.parametrize("base", [
    "https://other.test/tenant/v1", "http://gateway.test/tenant/v1",
    "https://gateway.test:444/tenant/v1", "https://gateway.test/other/v1", "",
])
def test_changed_root_cannot_reuse_key(base):
    with pytest.raises(ValueError, match="API Key"):
        resolve_model_connection({"model_base_url": base}, SAVED)


def test_equivalent_root_and_omission_keep_credential():
    assert resolve_model_connection({}, SAVED)["api_key"] == "fake-old-key"
    assert resolve_model_connection({"model_base_url": "https://GATEWAY.test:443/tenant/v1/"}, SAVED)["api_key"] == "fake-old-key"


def test_blank_root_uses_default_without_environment_fallback():
    result = resolve_model_connection({"model_base_url": "", "api_key": "fake-new-key"}, SAVED)
    assert result["model_base_url"] == "https://api.openai.com/v1"
    assert result["configured_model_base_url"] == ""
    assert result["api_key"] == "fake-new-key"


def test_blank_saved_root_uses_saved_model_family_for_credential_identity():
    with pytest.raises(ValueError, match="API Key"):
        resolve_model_connection({"model_name": "claude-test"}, {**SAVED, "model_base_url": ""})


def test_ollama_never_carries_cloud_key():
    result = resolve_model_connection({"model_protocol": "ollama", "model_base_url": ""}, SAVED)
    assert result["model_base_url"] == "http://127.0.0.1:11434"
    assert result["api_key"] == ""


def test_gemini_root_is_canonical_but_custom_path_preserved():
    assert normalize_api_root("https://generativelanguage.googleapis.com/", "gemini").endswith("/v1beta")
    assert normalize_api_root("https://gateway.test/native", "gemini") == "https://gateway.test/native"
    assert normalize_api_root("https://gateway.test", "openai") == "https://gateway.test"


@pytest.mark.parametrize("base", ["gateway.test/v1", "ftp://gateway.test", "https://user:secret@gateway.test", "https://gateway.test?key=secret", "https://gateway.test#fragment"])
def test_invalid_or_credential_bearing_roots_rejected(base):
    with pytest.raises(ValueError, match="Base URL"):
        normalize_api_root(base)

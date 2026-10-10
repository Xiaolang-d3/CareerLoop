import os

# Tests never read real credentials or the host operating-system keychain.
# Dedicated backend tests override these values and mock every keyring call.
os.environ["CAREERLOOP_SECRET_BACKEND"] = "memory"
os.environ["OPENAI_API_KEY"] = ""
os.environ["MODEL_BASE_URL"] = ""
# The pre-LiteLLM suites patch the native adapters (OpenAI SDK / httpx); they
# pin the rollback backend explicitly. LiteLLM suites opt in per test with
# monkeypatch.setenv("DENGDENG_MODEL_BACKEND", "litellm") and a loopback server.
os.environ["DENGDENG_MODEL_BACKEND"] = "native"
# Loopback fake model servers must never be routed through a developer proxy.
os.environ["NO_PROXY"] = os.environ["no_proxy"] = ",".join(
    filter(None, ["127.0.0.1", "localhost", os.environ.get("NO_PROXY", "")])
)

# Keep unit tests offline and deterministic. Production default remains auto/fastembed.
os.environ.setdefault("EMBEDDING_BACKEND", "hash")


import pytest


@pytest.fixture(autouse=True)
def fake_secret_store(monkeypatch):
    # unittest setUp/tearDown also changes this variable; restore it per test.
    monkeypatch.setenv("CAREERLOOP_SECRET_BACKEND", "memory")

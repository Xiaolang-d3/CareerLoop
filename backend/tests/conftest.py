import os

# Tests never read real credentials or the host operating-system keychain.
# Dedicated backend tests override these values and mock every keyring call.
os.environ["CAREERLOOP_SECRET_BACKEND"] = "memory"
os.environ["OPENAI_API_KEY"] = ""
os.environ["MODEL_BASE_URL"] = ""

# Keep unit tests offline and deterministic. Production default remains auto/fastembed.
os.environ.setdefault("EMBEDDING_BACKEND", "hash")


import pytest


@pytest.fixture(autouse=True)
def fake_secret_store(monkeypatch):
    # unittest setUp/tearDown also changes this variable; restore it per test.
    monkeypatch.setenv("CAREERLOOP_SECRET_BACKEND", "memory")

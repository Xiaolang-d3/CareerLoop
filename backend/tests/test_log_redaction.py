"""Log records never carry API keys, including exception chains and DEBUG SDK logs."""
from __future__ import annotations

import io
import logging

import pytest

from app.redaction import SecretRedactingFilter, install_log_redaction, remember_secret

KEY = "gw-PRIVATE-key-0123456789"  # no well-known prefix: only verbatim masking catches it


@pytest.fixture
def capture():
    install_log_redaction()
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(name)s %(levelname)s %(message)s"))
    logger = logging.getLogger("test.redaction")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    yield logger, stream
    logger.removeHandler(handler)


def test_message_args_and_exception_chain_are_redacted(capture):
    logger, stream = capture
    remember_secret(KEY)
    try:
        try:
            raise ValueError(f'upstream said: {{"error": "key {KEY} invalid", "auth": "Bearer {KEY}"}}')
        except ValueError as upstream:
            raise RuntimeError("model call failed") from upstream
    except RuntimeError:
        logger.warning("call with %s failed: %r", KEY, {"api_key": KEY}, exc_info=True)
    logger.debug("raw %s", ValueError(f"sk-abcdefghijklmn {KEY}"))
    output = stream.getvalue()
    assert KEY not in output and "sk-abcdefghijklmn" not in output
    assert "upstream said" in output and "Traceback" in output and "***" in output


def test_args_keep_their_shape_for_formatters(capture):
    # uvicorn's access formatter unpacks record.args.
    logger, stream = capture
    remember_secret(KEY)
    record = logger.makeRecord("test.redaction", logging.INFO, __file__, 1, '%s - "%s %s" %d',
                               ("127.0.0.1", "GET", f"/x?key={KEY}", 200), None)
    assert record.args[0] == "127.0.0.1" and record.args[3] == 200
    assert KEY not in record.args[2]


def test_existing_handlers_get_filter_and_sdk_debug_logs_are_redacted(capture):
    logger, stream = capture
    remember_secret(KEY)
    for name in ("LiteLLM", "openai._base_client", "httpx"):
        sdk = logging.getLogger(name)
        old = sdk.level
        sdk.addHandler(logger.handlers[0])
        sdk.setLevel(logging.DEBUG)
        try:
            sdk.debug("Encountered Exception: %s", f"Error code: 401 - {{'message': 'bad key {KEY}'}}")
        finally:
            sdk.removeHandler(logger.handlers[0])
            sdk.setLevel(old)
    assert KEY not in stream.getvalue() and stream.getvalue().count("***") == 3


def test_filter_class_works_standalone():
    record = logging.LogRecord("x", logging.ERROR, __file__, 1, "Authorization: Bearer abcdefgh1234", None, None)
    SecretRedactingFilter().filter(record)
    assert "abcdefgh1234" not in record.getMessage()


def test_provider_construction_registers_key():
    from app.models.litellm_provider import LiteLLMProvider
    from app.models.openai_compatible import OpenAICompatibleProvider
    from app.redaction import known_secrets

    LiteLLMProvider("lite-key-zzzz-1111", "m", "http://127.0.0.1:9/v1", 5, protocol="openai")
    OpenAICompatibleProvider(api_key="native-key-zzzz-2222", model="m", base_url="http://127.0.0.1:9/v1", timeout_seconds=5)
    assert {"lite-key-zzzz-1111", "native-key-zzzz-2222"} <= set(known_secrets())

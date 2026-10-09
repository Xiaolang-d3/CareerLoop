from __future__ import annotations

from typing import Any

from .base import ModelProviderError


def upstream_error_detail(exc: Exception) -> str:
    """Read the upstream JSON reason without interpreting HTTP error URL text."""
    payload: Any = getattr(exc, "body", None)
    response = getattr(exc, "response", None)
    if payload is None and response is not None:
        try:
            payload = response.json()
        except (AttributeError, ValueError, TypeError):
            return str(getattr(exc, "message", "") or "")
    if not isinstance(payload, dict):
        return str(payload) if isinstance(payload, str) else str(getattr(exc, "message", "") or "")
    error = payload.get("error", payload)
    if isinstance(error, str):
        return error
    if isinstance(error, dict):
        return str(error.get("message") or error.get("detail") or error.get("code") or "")
    return ""


def is_vision_rejection(message: str, status_code: int | None) -> bool:
    """Only explicit image-capability rejections count as an unsupported model."""
    if status_code not in {400, 415, 422}:
        return False
    text = message.lower()
    if any(word in text for word in ("max_tokens", "max_output_tokens", "max_completion_tokens", "invalid image", "image size", "image dimensions", "image format")):
        return False
    image_related = any(word in text for word in ("image", "vision", "multimodal"))
    rejected = any(word in text for word in ("does not support", "not support", "unsupported", "not allowed", "text-only", "text only", "only supports text"))
    return rejected and (image_related or "text-only" in text or "text only" in text or "only supports text" in text)


def _field(value: Any, name: str, default: Any = None) -> Any:
    return value.get(name, default) if isinstance(value, dict) else getattr(value, name, default)


def validate_diagnostic_response(result: Any, raw: Any, protocol: str) -> None:
    """A diagnostic must receive a finished inference, not an empty envelope.

    Keep this stricter check out of the runtime converter: tool/stream handling
    has its own completion contract. A real token-limit result or structured
    refusal is a valid protocol response even when it has no answer text.
    """
    content = bool(result.content or result.tool_calls)
    output_tokens = int(getattr(result.usage, "output_tokens", 0) or 0)
    valid = False
    if protocol == "openai":
        choices = _field(raw, "choices", []) or []
        choice = choices[0] if choices else None
        finish = _field(choice, "finish_reason")
        refusal = bool(_field(_field(choice, "message"), "refusal"))
        valid = finish in {"stop", "length", "tool_calls", "function_call", "content_filter"} and (
            content or refusal or finish == "content_filter" or (finish == "length" and output_tokens > 0)
        )
    elif protocol == "responses":
        status = _field(raw, "status")
        output = _field(raw, "output", []) or []
        refusal = any(
            _field(part, "type") == "refusal" and bool(_field(part, "refusal"))
            for item in output
            for part in (_field(item, "content", []) or [])
        )
        truncated = status == "incomplete" and _field(_field(raw, "incomplete_details"), "reason") == "max_output_tokens"
        valid = status in {"completed", "incomplete"} and (content or refusal or (truncated and output_tokens > 0))
    elif protocol == "anthropic":
        finish = _field(raw, "stop_reason")
        valid = finish in {"end_turn", "max_tokens", "stop_sequence", "tool_use", "refusal"} and (
            content or finish == "refusal" or (finish == "max_tokens" and output_tokens > 0)
        )
    elif protocol == "gemini":
        candidates = _field(raw, "candidates", []) or []
        candidate = candidates[0] if candidates else None
        finish = _field(candidate, "finishReason")
        refusals = {"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"}
        valid = finish in {"STOP", "MAX_TOKENS", *refusals} and (
            content or finish in refusals or (finish == "MAX_TOKENS" and output_tokens > 0)
        )
    elif protocol == "ollama":
        finish = _field(raw, "done_reason") or None
        valid = _field(raw, "done") is True and finish in {None, "stop", "length", "tool_calls"} and (
            content or (finish == "length" and output_tokens > 0)
        )
    if not valid:
        raise ModelProviderError(
            "invalid_provider_response",
            f"模型服务的 {protocol} 响应缺少有效完成状态或内容，无法确认连接或图片输入可用",
        )

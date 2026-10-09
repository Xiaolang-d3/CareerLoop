from __future__ import annotations

from typing import Any, Literal

from ..config import get_settings
from ..model_protocol import PROTOCOL_LABELS, normalize_model_protocol, resolve_model_protocol

CapabilityStatus = Literal["supported", "unsupported", "unknown"]
CapabilitySource = Literal["model_id", "probe", "client"]

_VISION_UNSUPPORTED = (
    "gpt-3.5",
    "text-embedding",
    "embedding",
    "whisper",
    "tts-",
    "dall-e",
    "davinci",
    "babbage",
    "o1-mini",
    "o1-preview",
    "o1",
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek-v3",
)
_VISION_SUPPORTED = (
    "gpt-4o",
    "gpt-4.1",
    "gpt-4-turbo",
    "gpt-4-vision",
    "gpt-5",
    "o3",
    "o4",
    "claude-3",
    "claude-4",
    "claude-sonnet",
    "claude-opus",
    "claude-haiku",
    "gemini-1.5",
    "gemini-2",
    "gemini-pro-vision",
    "gemini-flash",
    "qwen-vl",
    "qwen2-vl",
    "qwen2.5-vl",
    "qwen3-vl",
    "glm-4v",
    "glm-4.5v",
    "glm-4.1v",
    "internvl",
)
_NON_CHAT = (
    "text-embedding",
    "embedding",
    "whisper",
    "tts-",
    "dall-e",
    "babbage",
    "davinci",
)


def provider_label(provider: str, base_url: str = "") -> str:
    native_labels = {
        "anthropic": "Anthropic",
        "gemini": "Google Gemini",
        "ollama": "Ollama",
        "responses": "OpenAI Responses",
    }
    if provider in native_labels:
        return native_labels[provider]
    if provider != "openai":
        return provider
    normalized = (base_url or "").lower()
    if normalized and "openai.com" not in normalized:
        return "OpenAI 兼容"
    return "OpenAI"


def _contains(model_name: str, needles: tuple[str, ...]) -> bool:
    name = model_name.lower()
    return any(needle in name for needle in needles)


def _flag(status: CapabilityStatus, source: CapabilitySource, detail: str) -> dict[str, str]:
    return {"status": status, "source": source, "detail": detail}


def infer_vision(model_name: str) -> dict[str, str]:
    if not model_name.strip():
        return _flag("unknown", "model_id", "尚未填写模型名称")
    if _contains(model_name, _VISION_UNSUPPORTED):
        return _flag("unsupported", "model_id", "该模型 ID 通常只接受文本，不支持图片输入")
    if _contains(model_name, _VISION_SUPPORTED):
        return _flag("supported", "model_id", "该模型 ID 通常支持图片 / 多模态输入")
    return _flag("unknown", "model_id", "无法从模型 ID 判断是否支持多模态，可点击检测")


def infer_streaming(model_name: str, protocol: str = "openai") -> dict[str, str]:
    if _contains(model_name, _NON_CHAT):
        return _flag("unsupported", "model_id", "该模型 ID 通常不是对话模型，不支持对话流式响应")
    if model_name.strip():
        label = {
            "anthropic": "Anthropic Messages",
            "gemini": "Gemini generateContent",
            "ollama": "Ollama Chat",
            "responses": "OpenAI Responses",
        }.get(protocol, "OpenAI 兼容 Chat Completions")
        return _flag("unknown", "client", f"当前 {label} 客户端已启用流式请求；服务是否支持尚未验证")
    return _flag("unknown", "client", "尚未填写模型名称")


def infer_tools(model_name: str) -> dict[str, str]:
    if _contains(model_name, _NON_CHAT):
        return _flag("unsupported", "model_id", "该模型 ID 通常不是对话模型，不支持工具调用")
    if model_name.strip():
        return _flag("unknown", "client", "当前客户端已启用工具 / function calling；服务是否支持尚未验证")
    return _flag("unknown", "client", "尚未填写模型名称")


def infer_model_capabilities(
    model_name: str,
    *,
    provider: str = "openai",
    base_url: str = "",
    protocol: str = "auto",
    actual_protocol: str | None = None,
) -> dict[str, Any]:
    name = model_name.strip()
    resolved_protocol = actual_protocol or resolve_model_protocol(name, protocol, base_url)
    configured_protocol = normalize_model_protocol(protocol)
    return {
        "model_name": name,
        "provider": actual_protocol or provider,
        "provider_label": provider_label(actual_protocol or provider, base_url),
        "protocol": resolved_protocol,
        "protocol_label": PROTOCOL_LABELS[resolved_protocol],
        "configured_protocol": configured_protocol,
        "predicted_protocol": resolve_model_protocol(name, "auto", base_url),
        "actual_protocol": actual_protocol,
        "protocol_source": "negotiated" if actual_protocol else "configured" if configured_protocol != "auto" else "predicted",
        "vision": infer_vision(name),
        "streaming": infer_streaming(name, resolved_protocol),
        "tools": infer_tools(name),
        "probed": False,
        "probe_error": None,
        "attachment_vision_enabled": get_settings().attachment_vision_enabled,
    }


def apply_actual_protocol(
    report: dict[str, Any],
    provider_or_protocol: Any,
    base_url: str = "",
) -> dict[str, Any]:
    """Update the report after a successful operation negotiated its wire format."""
    protocol = str(getattr(provider_or_protocol, "name", provider_or_protocol))
    report["provider"] = protocol
    report["provider_label"] = provider_label(protocol, base_url)
    report["protocol"] = protocol
    report["protocol_label"] = PROTOCOL_LABELS[protocol]
    report["actual_protocol"] = protocol
    report["protocol_source"] = "negotiated"
    report["streaming"] = infer_streaming(str(report.get("model_name") or ""), protocol)
    return report


def build_model_list(
    default_name: str,
    discovered: list[str],
    *,
    provider: str = "openai",
    base_url: str = "",
) -> list[dict[str, Any]]:
    names: list[str] = []
    for name in [default_name, *discovered]:
        cleaned = name.strip()
        if cleaned and cleaned not in names:
            names.append(cleaned)
    label = provider_label(provider, base_url)
    return [
        {
            "name": name,
            "provider": provider,
            "provider_label": label,
            "is_default": name == default_name.strip(),
            "availability": "unverified",
            "availability_label": "未验证" if name == default_name.strip() else "仅目录可见",
        }
        for name in names
    ]

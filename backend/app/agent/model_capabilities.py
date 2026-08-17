from __future__ import annotations

from typing import Any, Literal

from ..config import get_settings

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


def infer_streaming(model_name: str) -> dict[str, str]:
    if _contains(model_name, _NON_CHAT):
        return _flag("unsupported", "model_id", "该模型 ID 不是对话模型，客户端不会对其发起流式请求")
    if model_name.strip():
        return _flag("supported", "client", "当前 OpenAI 兼容客户端会对该对话模型发起流式请求")
    return _flag("unknown", "client", "尚未填写模型名称")


def infer_tools(model_name: str) -> dict[str, str]:
    if _contains(model_name, _NON_CHAT):
        return _flag("unsupported", "model_id", "该模型 ID 不是对话模型，不会发送 function calling")
    if model_name.strip():
        return _flag("supported", "client", "当前客户端会向该对话模型发送工具 / function calling")
    return _flag("unknown", "client", "尚未填写模型名称")


def infer_model_capabilities(
    model_name: str,
    *,
    provider: str = "openai",
    base_url: str = "",
) -> dict[str, Any]:
    name = model_name.strip()
    return {
        "model_name": name,
        "provider": provider,
        "provider_label": provider_label(provider, base_url),
        "vision": infer_vision(name),
        "streaming": infer_streaming(name),
        "tools": infer_tools(name),
        "probed": False,
        "probe_error": None,
        "attachment_vision_enabled": get_settings().attachment_vision_enabled,
    }


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
        }
        for name in names
    ]

"""Output classification and per-purpose defaults, stored with the routing policy."""
from __future__ import annotations

import json
import re

from ..model_protocol import is_image_generation_model, model_protocol_for_profile, resolve_model_protocol
from . import settings


def model_output_types(profile, connection):
    name = profile["model_name"].strip().lower().rsplit("/", 1)[-1]
    caps = profile.get("capabilities") or {}
    explicit = [kind for kind, key in (("chat", "chat"), ("image", "image_generation"), ("video", "video_generation")) if caps.get(key) == "supported"]
    if re.search(r"(?:^|[-_.])(?:sora|veo|kling|seedance|cogvideo|ltx-video|hunyuan-video|grok-imagine-video)(?:$|[-_.\d])|^wan[-_.]?\d", name):
        inferred = ["video"]
    elif re.search(r"^(?:gpt-image-|chatgpt-image-|dall-e-|imagen[-_.]|flux[-_.]|stable-diffusion|sdxl|sd3[-_.]|qwen-image|z-image|nano-banana|seedream|ideogram|recraft|grok-imagine-image)|^gemini.*[-_.]image(?:$|[-_.])", name) or connection.get("protocol", connection.get("model_protocol")) == "images":
        inferred = ["image"]
    elif re.match(r"^grok-4[.-]7(?:[-.]|$)", name):
        inferred = ["chat", "image"]
    elif re.match(r"^(?:gpt-|chatgpt-|o[134](?:[-_.]|$)|claude|gemini|qwen|deepseek|grok|llama|mistral|mixtral|gemma|glm|kimi|minimax|doubao|yi-|command-r|phi[-.]|ernie)", name):
        inferred = ["chat"]
    else:
        inferred = []
    keys = {"chat": "chat", "image": "image_generation", "video": "video_generation"}
    types = [kind for kind in dict.fromkeys([*inferred, *explicit]) if caps.get(keys[kind]) != "unsupported"]
    source = "configured" if any(caps.get(key) in {"supported", "unsupported"} for key in keys.values()) else "inferred" if inferred else "unknown"
    return types, source


def supported_purposes(profile, connection):
    types, _ = model_output_types(profile, connection)
    protocol = model_protocol_for_profile(profile["model_name"], connection.get("protocol", connection.get("model_protocol", "auto")))
    base = connection.get("effective_base_url", connection.get("model_base_url", ""))
    result = []
    if "chat" in types and resolve_model_protocol(profile["model_name"], protocol, base) != "images":
        result.append("chat")
    if "image" in types and is_image_generation_model(profile["model_name"], protocol, base):
        result.append("image")
    return result


def purpose_defaults(conn):
    row = conn.execute("SELECT version, payload_json FROM model_routing_policy WHERE id=1").fetchone()
    payload = json.loads(row["payload_json"])
    defaults = dict(payload.get("purpose_defaults", {}))
    # Only inherit the old explicit default; never guess another enabled model.
    legacy = conn.execute("SELECT default_model_profile_id FROM agent_settings WHERE id=1").fetchone()[0]
    if legacy:
        from .model_catalog import _profile, _connection
        profile = _profile(conn, legacy)
        for kind in supported_purposes(profile, _connection(conn, profile["connection_id"])):
            defaults.setdefault(kind, legacy)
    return {"chat": defaults.get("chat"), "image": defaults.get("image")}, row["version"]


def save_purpose_default(kind, values, db_path=None):
    from .model_catalog import _mutate, _profile, _connection

    if kind not in {"chat", "image"}:
        raise ValueError("暂不支持此模型用途")

    def operation(conn, _candidates):
        defaults, version = purpose_defaults(conn)
        if values.get("expected_version") != version:
            raise settings.AgentSettingsConflict("使用规则已更新，请重新读取后保存")
        profile_id = values.get("profile_id")
        if profile_id:
            profile = _profile(conn, profile_id)
            source = _connection(conn, profile["connection_id"])
            if not profile["enabled"] or not source["enabled"]:
                raise ValueError("模型或连接已停用")
            if kind not in supported_purposes(profile, source):
                raise ValueError("模型能力或已接入的接口不支持此用途，请先确认模型能力")
            if not source["secret_ref"] or source["secret_ref"] == "none":
                if source["protocol"] != "ollama":
                    raise ValueError("请先配置此连接的密钥")
            if kind == "chat" or not conn.execute("SELECT default_model_profile_id FROM agent_settings WHERE id=1").fetchone()[0]:
                conn.execute("UPDATE agent_settings SET default_model_profile_id=? WHERE id=1", (profile_id,))
        defaults[kind] = profile_id
        row = conn.execute("SELECT payload_json FROM model_routing_policy WHERE id=1").fetchone()
        payload = json.loads(row[0])
        payload["purpose_defaults"] = defaults
        conn.execute("UPDATE model_routing_policy SET version=version+1, payload_json=? WHERE id=1", (json.dumps(payload),))

    _mutate(f"purpose_default:{kind}", values, db_path, operation)


def protect_purpose_defaults(conn, *, profile_id=None, connection_id=None):
    from .model_catalog import _profile

    defaults, _ = purpose_defaults(conn)
    for kind, selected in defaults.items():
        if selected and (selected == profile_id or (connection_id and _profile(conn, selected)["connection_id"] == connection_id)):
            label = "聊天" if kind == "chat" else "图片"
            raise ValueError(f"请先更换或清除{label}默认模型，再停用此模型或连接")

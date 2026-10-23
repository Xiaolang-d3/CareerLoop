"""Conservative editorial labels for model selection news, not company news."""

from __future__ import annotations

import re
from typing import Any


def topic(item: dict[str, Any]) -> str | None:
    title = str(item.get("title") or "").casefold()
    text = f"{title} {item.get('summary') or ''}".casefold()
    # A company feed also contains fundraising, hiring and customer stories.
    if re.search(r"\b(funding|fundrais\w*|acquir\w*|acquisition|partnership|appoint\w*|join\w*|customer story)\b|融资|收购|人事|合作伙伴|携手|入职", title):
        return None
    model = bool(re.search(r"\b(model|llm|gpt[ -]?\d|o[134]\b|claude|gemini|deepseek|qwen|hunyuan|grok|glm|kimi)\b|\b(?:qwen|hunyuan|glm|grok)\d|模型|千问|混元|智谱|豆包", text))
    if not model:
        return None
    pricing = r"\b(pric\w*|cost\w*|cheaper|affordab\w*|token pricing)\b|价格|定价|降价|费用|成本|计费"
    evaluation = r"\b(benchmark\w*|eval\w*|leaderboard\w*|intelligence index|swe-bench|livebench)\b|评测|测评|基准|能力对比|性能对比|排行榜"
    if re.search(pricing, title):
        return "pricing"
    if re.search(evaluation, title):
        return "evaluation"
    # Versioned model names also identify releases with terse titles, e.g. Qwen3.
    version = r"(?:(?:gpt|claude|gemini|deepseek|qwen|hunyuan|grok|glm|kimi)[a-z -]{0,15}\d|(?:千问|混元)\s*\d)"
    launch = r"\b(introduc\w*|releas\w*|launch\w*|unveil\w*|new|available|upgrade\w*)\b|发布|推出|上线|开源|升级|全新"
    model_release = re.search(r"\b(?:new|latest|language|reasoning|multimodal|open[- ]weight) models?\b|新模型|基础模型|大模型", text)
    if (re.search(launch, title) and (re.search(r"\bmodels?\b|模型|" + version, title) or model_release)) or re.fullmatch(version + r"[\w .()-]*", title):
        return "release"
    if re.search(evaluation, text):
        return "evaluation"
    if re.search(pricing, text):
        return "pricing"
    return None


def select(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**item, "category": category} for item in items if (category := topic(item))]

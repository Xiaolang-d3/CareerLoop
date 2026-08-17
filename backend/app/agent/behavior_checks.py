from __future__ import annotations

import json
import re
from typing import Any

from ..domain import ModelResponse
from .orchestration import (
    TOOL_POLICIES,
    TaskRoute,
    parse_classified_kind,
    parse_plan,
    refine_route_from_classifier,
    route_task,
    tools_for_kind,
)


CLAIM_PATTERNS = (
    re.compile(r"我(?:曾|曾经)?(?:负责|主导|参与)了?([^，。！？,\n]{2,20})"),
    re.compile(r"我在《?([^，。！？,\n]{2,20}?)》?项目"),
)
ASK_MARKERS = ("还是", "哪一家", "哪份", "哪一个", "你是指", "请确认")


def apply_classifier_output(query: str, model_output: str) -> dict[str, Any]:
    route = route_task(query, set(TOOL_POLICIES))
    refined = refine_route_from_classifier(
        route,
        query,
        set(TOOL_POLICIES),
        ModelResponse(content=model_output),
    )
    classified = parse_classified_kind(ModelResponse(content=model_output))
    return {
        "keyword_kind": route.kind,
        "kind": refined.kind,
        "allowed_tools": list(refined.allowed_tools),
        "classified_kind": classified,
        "ask_user_in_lane": "ask_user" in refined.allowed_tools,
    }


def apply_planner_output(query: str, kind: str, model_output: str) -> dict[str, Any]:
    route = TaskRoute(
        kind=kind,
        needs_plan=True,
        allowed_tools=tools_for_kind(kind, query, set(TOOL_POLICIES)),
    )
    plan = parse_plan(ModelResponse(content=model_output), query, route)
    parsed = list(plan.steps and [step.tool_name for step in plan.steps] or [])
    raw_names = _raw_plan_tools(model_output)
    return {
        "kind": kind,
        "allowed_tools": list(route.allowed_tools),
        "parsed_tools": parsed,
        "dropped_tools": [name for name in raw_names if name not in parsed],
        "ask_user_in_lane": "ask_user" in parsed,
    }


def unverified_experience_claims(answer: str, evidence: str) -> list[str]:
    haystack = evidence.casefold()
    claims: list[str] = []
    for pattern in CLAIM_PATTERNS:
        for match in pattern.finditer(answer):
            span = match.group(1).strip(" \t，、；;的")
            if span and span.casefold() not in haystack:
                claims.append(span)
    return claims


def ask_user_behavior(content: str, tool_names: list[str]) -> dict[str, Any]:
    used = "ask_user" in tool_names
    looks_like_question = ("？" in content or "?" in content) and any(
        marker in content for marker in ASK_MARKERS
    )
    return {
        "used_ask_user": used,
        "should_ask_user": looks_like_question and not used,
        "violation": looks_like_question and not used,
    }


def simulated_tool_names(raw_calls: list[dict[str, Any]] | str | None) -> list[str]:
    if isinstance(raw_calls, str):
        return [item.strip() for item in raw_calls.split(",") if item.strip()]
    names: list[str] = []
    for item in raw_calls or []:
        name = str(item.get("name") or "").strip()
        if name:
            names.append(name)
    return names


def _raw_plan_tools(model_output: str) -> list[str]:
    try:
        payload = json.loads(model_output)
    except Exception:
        return []
    if not isinstance(payload, dict):
        return []
    names: list[str] = []
    for item in payload.get("steps") or []:
        if isinstance(item, dict) and item.get("tool_name"):
            names.append(str(item["tool_name"]))
    return names


from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..agent.settings import get_model_connection
from ..config import get_settings
from ..domain import AgentMessage, ModelRequest
from ..jobs.quick_match import analyze_job_description
from ..models import ModelProviderError, build_model_provider
from ..model_protocol import protocol_requires_api_key


ANALYSIS_STEPS: tuple[tuple[str, str, str], ...] = (
    ("direction", "方向匹配", "意向、身份和岗位是否对得上"),
    ("project_evidence", "项目证据", "经历块里有没有可引用原句"),
    ("quantified", "量化结果", "数字、规模和验收是否可核对"),
    ("risks", "风险/缺口", "缺模块、只清单、证据偏薄的地方"),
    ("next_step", "下一步", "先改简历、准备面试，还是确认事实"),
)

_LOCAL_LIMITATION = "本次为本地分析，未调用模型"
_FALLBACK_LIMITATION = "模型润色失败，已保留本地分析结果"


def encode_sse(event: dict[str, Any]) -> str:
    name = str(event.get("type") or "message")
    return f"event: {name}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _analysis(result: dict[str, Any]) -> dict[str, Any]:
    payload = result.get("analysis")
    return payload if isinstance(payload, dict) else {}


def _resume(result: dict[str, Any]) -> dict[str, Any]:
    payload = _analysis(result).get("resume")
    return payload if isinstance(payload, dict) else {}


def checklist_by_key(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    for item in _resume(result).get("checklist") or []:
        if isinstance(item, dict) and item.get("key"):
            items[str(item["key"])] = item
    return items


def step_process_lines(result: dict[str, Any], key: str) -> list[str]:
    """Honest local process lines from what analyze_resume already inspected."""
    analysis = _analysis(result)
    resume = _resume(result)
    scan = resume.get("scan") if isinstance(resume.get("scan"), dict) else {}
    lines: list[str] = []

    if key == "direction":
        lines.append("在已保存简历里读取身份和求职意向")
        identity = str(scan.get("identity") or "").strip()
        target = str(scan.get("target") or "").strip()
        if identity:
            lines.append(f"身份写的是{identity}")
        if target:
            lines.append(f"求职意向是{target}")
        else:
            lines.append("简历未写明求职意向，方向只能从经历反推")
        if analysis.get("mode") == "job_match":
            matched = [str(item) for item in analysis.get("matched_skills") or [] if item]
            missing = [str(item) for item in analysis.get("missing_skills") or [] if item]
            if matched:
                lines.append(f"岗位技能词对上了{'、'.join(matched[:3])}")
            if missing:
                lines.append(f"还没有原句的要求：{'、'.join(missing[:3])}")
        else:
            lines.append("这次没有对照具体岗位")
        return lines

    if key == "project_evidence":
        lines.append("拆项目和工作经历块，找可引用原句")
        projects = [item for item in resume.get("projects") or [] if isinstance(item, dict)]
        talking = str(resume.get("talking_source") or "")
        if talking == "work":
            lines.append("没有拆出独立项目，改按工作经历核对")
        if projects:
            lines.append(f"核到 {len(projects)} 段可讲的经历")
            weak = [str(item.get("title") or "") for item in projects if item.get("weak")]
            if weak:
                lines.append(f"「{weak[0]}」证据还偏薄")
        else:
            lines.append("还没有识别出可引用的项目原句")
        return lines

    if key == "quantified":
        lines.append("在简历里找带数字的结果句")
        proof = scan.get("proof") if isinstance(scan.get("proof"), dict) else {}
        metric_lines = int(proof.get("metric_lines") or 0)
        evidence_lines = int(proof.get("evidence_lines") or 0)
        if metric_lines:
            lines.append(f"找到 {metric_lines} 条带数字的原句")
        else:
            lines.append("没有可核对的数字，不会编造结果")
        if evidence_lines:
            lines.append(f"另有 {evidence_lines} 条经历原句可引用")
        return lines

    if key == "risks":
        lines.append("核对缺失模块，以及只出现在技能清单里的词")
        gaps = [str(item) for item in resume.get("gaps") or [] if item]
        missing = []
        structure = resume.get("structure") if isinstance(resume.get("structure"), dict) else {}
        missing = [str(item) for item in structure.get("missing") or [] if item]
        if missing:
            lines.append(f"结构上看不到{'、'.join(missing[:3])}")
        if gaps:
            lines.append(gaps[0])
        elif not missing:
            lines.append("这一步没有额外的硬缺口")
        return lines

    if key == "next_step":
        lines.append("按缺口排出先改简历、准备面试还是核对事实")
        actions = [item for item in resume.get("next_actions") or [] if isinstance(item, dict)]
        if actions:
            title = str(actions[0].get("title") or "").strip()
            if title:
                lines.append(f"当前最优先：{title}")
        else:
            lines.append("没有排出必须立刻改的下一项")
        return lines

    return lines


def _decode_json(content: str) -> dict[str, Any]:
    clean = content.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", clean, flags=re.IGNORECASE).strip()
    try:
        payload = json.loads(clean)
    except json.JSONDecodeError as exc:
        raise ModelProviderError("invalid_structure", "模型未返回有效的分析润色数据") from exc
    if not isinstance(payload, dict):
        raise ModelProviderError("invalid_structure", "模型返回的分析润色格式无效")
    return payload


def _clip(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return text if len(text) <= limit else text[: limit - 1] + "…"


def apply_model_refine(result: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """Overwrite wording only. Never invent new evidence, skills, or actions."""
    if not isinstance(payload, dict):
        return result
    resume = _resume(result)
    if not resume:
        return result

    headline_in = payload.get("headline")
    headline = resume.get("headline")
    if isinstance(headline_in, dict) and isinstance(headline, dict):
        for field in ("verdict", "remember", "skip"):
            value = _clip(headline_in.get(field), 240)
            if value:
                headline[field] = value

    by_key = checklist_by_key(result)
    for item in payload.get("checklist") or []:
        if not isinstance(item, dict):
            continue
        current = by_key.get(str(item.get("key") or ""))
        if not current:
            continue
        summary = _clip(item.get("summary"), 240)
        if summary:
            current["summary"] = summary

    current_actions = [item for item in resume.get("next_actions") or [] if isinstance(item, dict)]
    refined_actions = [item for item in payload.get("next_actions") or [] if isinstance(item, dict)]
    for current, incoming in zip(current_actions, refined_actions):
        for field, limit in (("title", 80), ("detail", 240), ("why", 160), ("where", 160), ("effect", 160)):
            value = _clip(incoming.get(field), limit)
            if value:
                current[field] = value
    return result


def refine_thoughts(payload: dict[str, Any]) -> list[str]:
    thoughts: list[str] = []
    top = _clip(payload.get("thinking"), 200)
    if top:
        thoughts.append(top)
    for item in payload.get("checklist") or []:
        if not isinstance(item, dict):
            continue
        line = _clip(item.get("thinking"), 160)
        if line and line not in thoughts:
            thoughts.append(line)
        if len(thoughts) >= 6:
            break
    return thoughts


def _append_limitation(result: dict[str, Any], message: str) -> None:
    analysis = result.setdefault("analysis", {})
    limitations = [str(item) for item in analysis.get("limitations") or [] if item]
    if message not in limitations:
        limitations.append(message)
    analysis["limitations"] = limitations


async def refine_analysis_with_model(
    result: dict[str, Any],
    *,
    connection: dict[str, str] | None = None,
    db_path: str | Path | None = None,
) -> tuple[dict[str, Any], str, list[str]]:
    settings = connection or get_model_connection(db_path)
    if (
        protocol_requires_api_key(settings.get("resolved_model_protocol", "openai"))
        and not str(settings.get("api_key") or "").strip()
    ):
        return result, "local", []

    resume = _resume(result)
    compact = {
        "headline": resume.get("headline"),
        "checklist": [
            {
                "key": item.get("key"),
                "title": item.get("title"),
                "status": item.get("status"),
                "summary": item.get("summary"),
            }
            for item in resume.get("checklist") or []
            if isinstance(item, dict)
        ],
        "gaps": resume.get("gaps"),
        "next_actions": [
            {
                "title": item.get("title"),
                "detail": item.get("detail"),
                "why": item.get("why"),
                "where": item.get("where"),
                "effect": item.get("effect"),
            }
            for item in resume.get("next_actions") or []
            if isinstance(item, dict)
        ],
        "scan": resume.get("scan"),
    }
    try:
        provider = build_model_provider(
            api_key=settings["api_key"],
            model=settings["model_name"],
            base_url=settings.get("model_base_url") or None,
            timeout_seconds=min(get_settings().model_timeout_seconds, 45),
            protocol=settings.get("model_protocol", "auto"),
        )
        content = ""
        async for event in provider.stream(
            ModelRequest(
                messages=[
                    AgentMessage(
                        role="system",
                        content=(
                            "你是简历分析润色助手。只改写表述，不补写经历、数字、公司或技能。"
                            "只返回 JSON，不要 Markdown。"
                        ),
                    ),
                    AgentMessage(
                        role="user",
                        content=(
                            "下面是本地规则已经核对过的简历分析。请润色 checklist.summary、"
                            "headline.verdict 和 next_actions 的 title/detail，使其更清楚，"
                            "但不得增加原文没有的事实。"
                            "返回 JSON：{thinking:string,checklist:[{key,summary,thinking}],"
                            "headline:{verdict?:string,remember?:string,skip?:string},"
                            "next_actions:[{title,detail,why,where,effect}]}。"
                            "thinking 用一两句说明你对照了什么、哪些没改。\n\n"
                            f"本地分析：\n{json.dumps(compact, ensure_ascii=False)[:12_000]}"
                        ),
                    ),
                ]
            )
        ):
            if event.type == "completed" and event.response is not None:
                content = event.response.content
        payload = _decode_json(content)
        return apply_model_refine(result, payload), "model", refine_thoughts(payload)
    except (ModelProviderError, ValueError, TypeError):
        return result, "local_fallback", [_FALLBACK_LIMITATION]


def _step_event(
    key: str,
    title: str,
    status: str,
    *,
    source: str,
    summary: str = "",
    label: str = "",
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": "step",
        "key": key,
        "title": title,
        "status": status,
        "source": source,
        "label": label or ("本地分析" if source != "model" else "AI 润色"),
    }
    if status == "done":
        event["summary"] = summary
        event["completed_at"] = _now()
    return event


def _thought_event(key: str, text: str, kind: str = "process") -> dict[str, Any]:
    return {"type": "thought", "key": key, "text": text, "kind": kind}


async def iter_analysis_run_events(
    job_description: str = "",
    *,
    job_title: str = "",
    company_name: str = "",
    db_path: str | Path | None = None,
) -> AsyncIterator[dict[str, Any]]:
    first_key, first_title, _question = ANALYSIS_STEPS[0]
    yield _step_event(first_key, first_title, "running", source="local")
    yield _thought_event(first_key, "先用本地规则核对已保存简历。")

    result = analyze_job_description(
        job_description,
        job_title=job_title,
        company_name=company_name,
        db_path=db_path,
    )
    connection = get_model_connection(db_path)
    has_key = bool(str(connection.get("api_key") or "").strip())
    source = "local"

    for index, (key, title, _question) in enumerate(ANALYSIS_STEPS):
        if index > 0:
            yield _step_event(key, title, "running", source="local")
        for line in step_process_lines(result, key):
            yield _thought_event(key, line)
            await asyncio.sleep(0)

        if key == "next_step" and has_key:
            yield _thought_event(key, "已配置模型，开始润色结论，不补写简历里没有的事实。")
            yield _step_event(key, title, "running", source="model", label="AI 润色")
            result, source, model_thoughts = await refine_analysis_with_model(
                result,
                connection=connection,
                db_path=db_path,
            )
            kind = "model" if source == "model" else "process"
            for line in model_thoughts:
                yield _thought_event(key, line, kind)

        item = checklist_by_key(result).get(key) or {}
        step_source = source if key == "next_step" else "local"
        yield _step_event(
            key,
            title,
            "done",
            source=step_source,
            summary=str(item.get("summary") or ""),
        )

    if source == "local" and not has_key:
        _append_limitation(result, _LOCAL_LIMITATION)
    elif source == "local_fallback":
        _append_limitation(result, _FALLBACK_LIMITATION)

    yield {"type": "result", "result": result, "source": source}


async def collect_analysis_run_events(
    job_description: str = "",
    *,
    job_title: str = "",
    company_name: str = "",
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    async for event in iter_analysis_run_events(
        job_description,
        job_title=job_title,
        company_name=company_name,
        db_path=db_path,
    ):
        events.append(event)
    return events

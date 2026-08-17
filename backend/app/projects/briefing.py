from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from ..agent.settings import get_model_connection
from ..config import get_settings
from ..domain import AgentMessage, ModelRequest
from ..interview.preparation import _get_state, _save_state, get_interview_preparation
from ..models import ModelProviderError, OpenAICompatibleProvider
from ..profile.candidate_core import ProfileNotInitializedError
from ..profile.intelligence import extract_skills
from .github_repo import (
    fetch_github_repo_snapshot,
    parse_github_repo_url,
    path_on_tree,
    representative_paths,
)


_BRIEFINGS_STATE_KEY = "_project_briefings"
_SOURCE_KINDS = {"description", "code", "repo"}
_README_NOISE = re.compile(r"!\[.*?\]\(.*?\)|^\s*\[!\[.*?\]\(.*?\)\]\(.*?\)\s*$")
_CLIENT_HINTS = (
    "麦克风", "pcm", "采集", "编码", "opus", "ogg", "分片", "客户端", "上行",
    "frontend", "react", "vue", "tsx", "microphone", "audio",
)
_SERVER_HINTS = (
    "服务端", "asr", "转写", "llm", "网关", "fastapi", "django", "flask",
    "backend", "server", "whisper",
)
_DATA_HINTS = ("redis", "kafka", "sqlite", "postgres", "mysql", "缓存", "队列")
_EXTRA_TECH = {
    "Opus": ("opus", "ogg/opus"),
    "Kafka": ("kafka",),
    "WebSocket": ("websocket", "websockets"),
    "SQLite": ("sqlite", "sqlite3"),
    "PCM": ("pcm",),
    "ASR": ("asr", "whisper"),
    "Nginx": ("nginx",),
}
_PATH_RE = re.compile(r"(?:^|[\s`\"'(])((?:[\w.-]+/){1,6}[\w.-]+\.[A-Za-z0-9]+)")
_CLAUSE_SPLIT = re.compile(r"[。；;\n]|──▶|-->|→")
_INPUT_FIELD = re.compile(r"背景|目标|职责|负责|角色|岗位")
_PROCESS_FIELD = re.compile(r"方案|技术|架构|栈|挑战|取舍|决策|实现|模块")
_OUTPUT_FIELD = re.compile(r"结果|指标|成果|影响|收益|效果")


def build_project_briefing(
    *,
    title: str,
    evidence: str = "",
    fields: list[dict[str, str]] | None = None,
    description: str = "",
    code_excerpt: str = "",
    source_kind: Literal["description", "code", "repo"] | str = "description",
    generated_from: Literal["rules", "model"] = "rules",
    repo_url: str = "",
    repo_owner: str = "",
    repo_name: str = "",
    default_branch: str = "",
) -> dict[str, Any]:
    """Turn resume text and optional code into a reviewable project briefing."""
    kind = source_kind if source_kind in _SOURCE_KINDS else ("code" if code_excerpt.strip() else "description")
    corpus = "\n".join(part for part in (title, evidence, description, code_excerpt) if part.strip())
    stack = _detect_stack(corpus)
    situation = _first_text(
        _field_values(fields, _INPUT_FIELD),
        _matching_clauses(evidence or description, ("背景", "目标", "面向", "为了")),
        _readme_situation(description) if kind == "repo" else "",
        _first_sentence(evidence or description),
    )
    core = _first_text(
        _field_values(fields, re.compile(r"职责|负责|核心")),
        _matching_clauses(evidence or description, ("负责", "核心", "主导")),
    )
    layers = (
        _layers_from_repo_excerpt(code_excerpt) if kind == "repo" else _layers_from_code(code_excerpt)
    ) or _layers_from_client_server(corpus) or _layers_from_fields(fields or [], evidence, title)
    missing = _missing_parts(situation, core, stack, layers)
    return {
        "source_kind": kind,
        "description": description.strip()[:8_000],
        "code_excerpt": code_excerpt.strip()[:20_000],
        "repo_url": repo_url.strip()[:500],
        "repo_owner": repo_owner.strip()[:100],
        "repo_name": repo_name.strip()[:100],
        "default_branch": default_branch.strip()[:100],
        "situation": situation[:240],
        "core": core[:240],
        "stack": stack,
        "layers": layers,
        "mermaid": _mermaid_from_layers(title, layers),
        "missing": missing,
        "generated_from": generated_from,
        "status": "needs_input" if missing else "ready",
    }


def get_project_studio(db_path: str | Path | None = None) -> dict[str, Any]:
    preparation = get_interview_preparation(db_path)
    if not preparation.get("has_profile"):
        return {
            "has_profile": False,
            "has_resume": False,
            "projects": [],
        }
    profile_id = int(preparation["profile"]["id"])
    state = _get_state(profile_id, db_path)
    saved = _briefings_from_state(state.get("node_state") or {})
    projects = []
    for item in preparation.get("experiences") or []:
        briefing = saved.get(item["id"]) or build_project_briefing(
            title=item.get("title") or "",
            evidence=item.get("evidence") or "",
            fields=item.get("fields") or [],
        )
        projects.append({
            "id": item["id"],
            "title": item.get("title") or "未命名项目",
            "evidence": item.get("evidence") or "",
            "fields": item.get("fields") or [],
            "gap_count": sum(1 for gap in item.get("gaps") or [] if not gap.get("completed")),
            "briefing": briefing,
        })
    return {
        "has_profile": True,
        "has_resume": bool(preparation.get("has_resume")),
        "projects": projects,
    }


async def analyze_project_briefing(
    project_id: str,
    *,
    source_kind: str = "description",
    description: str = "",
    code_excerpt: str = "",
    repo_url: str = "",
    use_model: bool = False,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    studio = get_project_studio(db_path)
    if not studio.get("has_profile"):
        raise ProfileNotInitializedError("请先创建候选人画像")
    project = next((item for item in studio["projects"] if item["id"] == project_id), None)
    if project is None:
        raise ValueError("没有找到这个项目，请先从简历里确认经历")
    kind = source_kind if source_kind in _SOURCE_KINDS else ("code" if code_excerpt.strip() else "description")
    notes = description.strip()
    code = code_excerpt.strip()
    snapshot: dict[str, Any] | None = None
    repo_meta = {"repo_url": "", "repo_owner": "", "repo_name": "", "default_branch": ""}
    if kind == "code" and not code:
        raise ValueError("从代码梳理时，请粘贴文件路径或关键代码")
    if kind == "repo":
        owner, name = parse_github_repo_url(repo_url)
        snapshot = await fetch_github_repo_snapshot(owner, name)
        notes = notes or snapshot["readme"]
        code = "\n".join(representative_paths(snapshot["paths"]))
        repo_meta = {
            "repo_url": repo_url.strip()[:500] or snapshot["html_url"],
            "repo_owner": snapshot["owner"],
            "repo_name": snapshot["repo"],
            "default_branch": snapshot["default_branch"],
        }
    briefing = build_project_briefing(
        title=project["title"],
        evidence=project["evidence"],
        fields=project["fields"],
        description=notes,
        code_excerpt=code,
        source_kind=kind,
        **repo_meta,
    )
    if use_model:
        if kind == "repo" and snapshot is not None:
            briefing = await _model_repo_briefing(
                project=project,
                description=notes,
                code_excerpt=code,
                snapshot=snapshot,
                fallback=briefing,
                db_path=db_path,
            )
        else:
            briefing = await _model_briefing(
                project=project,
                source_kind=kind,
                description=notes,
                code_excerpt=code,
                fallback=briefing,
                db_path=db_path,
            )
    briefing["updated_at"] = datetime.now(timezone.utc).isoformat()
    _persist_briefing(project_id, briefing, db_path)
    return get_project_studio(db_path)


def _persist_briefing(project_id: str, briefing: dict[str, Any], db_path: str | Path | None) -> None:
    preparation = get_interview_preparation(db_path)
    profile_id = int(preparation["profile"]["id"])
    revision = int(preparation.get("source_revision") or 0)
    state = _get_state(profile_id, db_path)
    node_state = dict(state.get("node_state") or {})
    stored = dict(node_state.get(_BRIEFINGS_STATE_KEY) or {})
    stored[project_id] = briefing
    node_state[_BRIEFINGS_STATE_KEY] = stored
    _save_state(profile_id, revision, node_state, db_path)


def _briefings_from_state(node_state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = node_state.get(_BRIEFINGS_STATE_KEY)
    if not isinstance(raw, dict):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for key, value in raw.items():
        if isinstance(value, dict) and value.get("layers") is not None:
            result[str(key)] = value
    return result


def _detect_stack(text: str) -> list[str]:
    found = list(extract_skills(text))
    seen = {item.casefold() for item in found}
    lowered = text.lower()
    for name, aliases in _EXTRA_TECH.items():
        if name.casefold() in seen:
            continue
        if any(alias in lowered for alias in aliases):
            found.append(name)
            seen.add(name.casefold())
    return found[:12]


def _field_values(fields: list[dict[str, str]] | None, pattern: re.Pattern[str]) -> list[str]:
    values: list[str] = []
    for item in fields or []:
        label = str(item.get("label") or "")
        value = str(item.get("value") or "").strip()
        if value and pattern.search(label):
            values.append(value)
    return values


def _matching_clauses(text: str, needles: tuple[str, ...]) -> list[str]:
    hits: list[str] = []
    for clause in _clauses(text):
        if any(needle in clause for needle in needles):
            hits.append(clause)
    return hits


def _first_sentence(text: str) -> str:
    for clause in _clauses(text):
        if len(clause) >= 8:
            return clause
    return text.strip().splitlines()[0].strip() if text.strip() else ""


def _first_text(*groups: str | list[str]) -> str:
    for group in groups:
        if isinstance(group, list) and group:
            return group[0]
        if isinstance(group, str) and group.strip():
            return group.strip()
    return ""


def _clauses(text: str) -> list[str]:
    parts = [_clean_clause(part) for part in _CLAUSE_SPLIT.split(text or "")]
    return [part for part in parts if part]


def _clean_clause(text: str) -> str:
    return re.sub(r"^[-•*·\s]+", "", text).strip()


def _readme_situation(readme: str) -> str:
    lines: list[str] = []
    for raw in (readme or "").splitlines():
        line = _README_NOISE.sub("", raw).strip()
        if line.startswith("#"):
            line = line.lstrip("#").strip()
        if not line or line.startswith("[") and "](" in line:
            continue
        lines.append(line)
        if len(lines) >= 2:
            break
    return _first_sentence(" ".join(lines))


def _layers_from_repo_excerpt(code_excerpt: str) -> list[dict[str, Any]]:
    paths = [line.strip() for line in (code_excerpt or "").splitlines() if _normalize_repo_line(line)]
    return _layers_from_paths(paths)


def _normalize_repo_line(line: str) -> str:
    return line.strip().replace("\\", "/")


def _layers_from_code(code_excerpt: str) -> list[dict[str, Any]]:
    paths = [match.group(1) for match in _PATH_RE.finditer(code_excerpt or "")]
    return _layers_from_paths(paths)


def _layers_from_paths(paths: list[str]) -> list[dict[str, Any]]:
    buckets: dict[str, list[dict[str, str]]] = {}
    for path in paths[:16]:
        cleaned = path.strip()
        if not cleaned:
            continue
        layer = _layer_for_path(cleaned)
        buckets.setdefault(layer, [])
        if len(buckets[layer]) >= 4:
            continue
        buckets[layer].append({"title": _path_step(cleaned), "detail": cleaned})
    return [{"name": name, "steps": steps} for name, steps in buckets.items() if steps]


def _layer_for_path(path: str) -> str:
    head = path.split("/", 1)[0].lower()
    lowered = path.lower()
    if head in {"frontend", "client", "web", "ios", "android", "src"} or any(
        token in lowered for token in ("component", "audio", "capture")
    ):
        return "客户端"
    if any(token in lowered for token in ("redis", "kafka", "sqlite", "postgres", "mysql")):
        return "数据与链路"
    return "服务端"


def _path_step(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    name = re.sub(r"\.[A-Za-z0-9]+$", "", name)
    return name.replace("_", " ").replace("-", " ") or path


def _layers_from_client_server(text: str) -> list[dict[str, Any]]:
    buckets: dict[str, list[str]] = {"客户端": [], "服务端": [], "数据与链路": []}
    for clause in _clauses(text):
        layer = _clause_layer(clause)
        if layer:
            buckets[layer].append(clause)
    if not buckets["客户端"] or not buckets["服务端"]:
        return []
    return [
        {"name": name, "steps": _steps_from_clauses(steps[:4])}
        for name, steps in buckets.items()
        if steps
    ]


def _clause_layer(clause: str) -> str | None:
    lowered = clause.lower()
    scores = [
        ("客户端", sum(1 for hint in _CLIENT_HINTS if hint in lowered)),
        ("服务端", sum(1 for hint in _SERVER_HINTS if hint in lowered)),
        ("数据与链路", sum(1 for hint in _DATA_HINTS if hint in lowered)),
    ]
    name, score = max(scores, key=lambda item: item[1])
    return name if score else None


def _has_hint(text: str, hints: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(hint in lowered for hint in hints)


def _steps_from_clauses(clauses: list[str]) -> list[dict[str, str]]:
    steps: list[dict[str, str]] = []
    seen: set[str] = set()
    for clause in clauses:
        key = clause.casefold()
        if key in seen:
            continue
        seen.add(key)
        steps.append({"title": clause[:18], "detail": clause[:80]})
    return steps


def _layers_from_fields(
    fields: list[dict[str, str]],
    evidence: str,
    title: str,
) -> list[dict[str, Any]]:
    buckets = {"职责": [], "方案": [], "结果": []}
    for item in fields:
        label = str(item.get("label") or "")
        value = str(item.get("value") or "").strip()
        if not value:
            continue
        if _OUTPUT_FIELD.search(label):
            buckets["结果"].append(value)
        elif _PROCESS_FIELD.search(label):
            buckets["方案"].append(value)
        elif _INPUT_FIELD.search(label):
            buckets["职责"].append(value)
        else:
            buckets["方案"].append(value)
    if not any(buckets.values()):
        beats = [
            line.replace("-", "", 1).strip() if line.lstrip().startswith("-") else line.strip()
            for line in evidence.splitlines()
        ]
        beats = [line.lstrip("•*· ").strip() for line in beats if line.strip() and line.strip() != title]
        if beats:
            buckets["职责"] = beats[:1]
            if len(beats) > 2:
                buckets["方案"] = beats[1:-1][:2]
            if len(beats) > 1:
                buckets["结果"] = beats[-1:]
    return [
        {"name": name, "steps": [{"title": value[:18], "detail": value[:80]} for value in values[:2]]}
        for name, values in buckets.items()
        if values
    ]


def _missing_parts(situation: str, core: str, stack: list[str], layers: list[dict[str, Any]]) -> list[str]:
    missing: list[str] = []
    if not situation:
        missing.append("项目情况")
    if not core:
        missing.append("项目核心")
    if not stack:
        missing.append("技术栈")
    if not layers:
        missing.append("项目架构")
    return missing


def _mermaid_from_layers(title: str, layers: list[dict[str, Any]]) -> str:
    if not layers:
        return ""
    lines = ["flowchart LR"]
    node_ids: list[str] = []
    index = 0
    for layer_index, layer in enumerate(layers):
        subgraph_id = f"L{layer_index}"
        lines.append(f"  subgraph {subgraph_id}[{_mermaid_label(str(layer.get('name') or title))}]")
        for step in layer.get("steps") or []:
            node_id = f"n{index}"
            lines.append(f"    {node_id}[{_mermaid_label(str(step.get('title') or step.get('detail') or '步骤'))}]")
            node_ids.append(node_id)
            index += 1
        lines.append("  end")
    if len(node_ids) >= 2:
        lines.append("  " + " --> ".join(node_ids))
    return "\n".join(lines)


def _mermaid_label(text: str) -> str:
    cleaned = re.sub(r"[\[\]{}|#;]", " ", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()[:24]
    return cleaned or "步骤"


async def _model_briefing(
    *,
    project: dict[str, Any],
    source_kind: str,
    description: str,
    code_excerpt: str,
    fallback: dict[str, Any],
    db_path: str | Path | None,
) -> dict[str, Any]:
    connection = get_model_connection(db_path)
    if not connection["api_key"]:
        raise ValueError("请先在 Agent 设置中配置模型，再做深度梳理")
    source = "\n".join(part for part in (
        project.get("title") or "",
        project.get("evidence") or "",
        json.dumps(project.get("fields") or [], ensure_ascii=False),
        description,
        code_excerpt,
    ) if part)
    provider = OpenAICompatibleProvider(
        api_key=connection["api_key"],
        model=connection["model_name"],
        base_url=connection["model_base_url"] or None,
        timeout_seconds=min(get_settings().model_timeout_seconds, 30),
    )
    response = await provider.generate(ModelRequest(messages=[
        AgentMessage(role="system", content=(
            "你是项目梳理助手。只根据给出的描述和代码摘录归纳，不补写指标、公司、"
            "未出现的技术或架构层。只返回 JSON。"
        )),
        AgentMessage(role="user", content=(
            "整理这个项目，返回 JSON："
            "{situation,core,stack:[string],layers:[{name,steps:[{title,detail}]}],missing:[string]}。"
            "layers 用于画全链路；没有证据的层不要输出。"
            f"来源类型：{source_kind}\n材料：\n{source[:16_000]}"
        )),
    ]))
    try:
        payload = _decode_json(response.content)
    except ModelProviderError:
        return fallback
    grounded = _ground_model_briefing(payload, source, fallback, source_kind, description, code_excerpt)
    return grounded


async def _model_repo_briefing(
    *,
    project: dict[str, Any],
    description: str,
    code_excerpt: str,
    snapshot: dict[str, Any],
    fallback: dict[str, Any],
    db_path: str | Path | None,
) -> dict[str, Any]:
    connection = get_model_connection(db_path)
    if not connection["api_key"]:
        raise ValueError("请先在 Agent 设置中配置模型，再做深度梳理")
    tree_text = "\n".join(snapshot["paths"][:400])
    materials = "\n".join(part for part in (
        project.get("title") or "",
        project.get("evidence") or "",
        json.dumps(project.get("fields") or [], ensure_ascii=False),
        description,
        f"仓库：{snapshot['owner']}/{snapshot['repo']}",
        f"目录：\n{tree_text}",
    ) if part)
    provider = OpenAICompatibleProvider(
        api_key=connection["api_key"],
        model=connection["model_name"],
        base_url=connection["model_base_url"] or None,
        timeout_seconds=min(get_settings().model_timeout_seconds, 30),
    )
    try:
        overview = await provider.generate(ModelRequest(messages=[
            AgentMessage(role="system", content=(
                "你是项目梳理助手。只根据仓库目录和 README 归纳，不补写未出现的技术。"
                "只返回 JSON。"
            )),
            AgentMessage(role="user", content=(
                "整理这个仓库，返回 JSON：{situation,core,stack:[string]}。"
                "stack 只能使用材料里出现的技术名。"
                f"材料：\n{materials[:16_000]}"
            )),
        ]))
        overview_payload = _decode_json(overview.content)
    except ModelProviderError:
        return fallback
    try:
        graph = await provider.generate(ModelRequest(messages=[
            AgentMessage(role="system", content=(
                "你是架构图助手。每个步骤必须带仓库里真实存在的 path。"
                "不要发明目录。只返回 JSON。"
            )),
            AgentMessage(role="user", content=(
                "按目录分层，返回 JSON："
                "{layers:[{name,steps:[{title,detail,path}]}]}。"
                "path 必须是下列目录中的文件或目录前缀。"
                f"目录：\n{tree_text[:12_000]}"
            )),
        ]))
        graph_payload = _decode_json(graph.content)
    except ModelProviderError:
        graph_payload = {}
    layers = _layers_from_model_paths(graph_payload.get("layers"), snapshot["paths"]) or fallback["layers"]
    lowered = materials.lower()
    stack = [
        item.strip()
        for item in overview_payload.get("stack") or []
        if isinstance(item, str) and item.strip() and item.strip().lower() in lowered
    ][:12] or fallback["stack"]
    situation = str(overview_payload.get("situation") or "").strip()
    if situation and situation[:8].lower() not in lowered:
        situation = fallback["situation"]
    core = str(overview_payload.get("core") or "").strip()
    if core and core[:8].lower() not in lowered:
        core = fallback["core"]
    return {
        **fallback,
        "source_kind": "repo",
        "description": description[:8_000],
        "code_excerpt": code_excerpt[:20_000],
        "situation": (situation or fallback["situation"])[:240],
        "core": (core or fallback["core"])[:240],
        "stack": stack,
        "layers": layers,
        "mermaid": _mermaid_from_layers(project.get("title") or snapshot["repo"], layers),
        "missing": _missing_parts(
            situation or fallback["situation"],
            core or fallback["core"],
            stack,
            layers,
        ),
        "generated_from": "model",
        "status": "needs_input" if _missing_parts(
            situation or fallback["situation"],
            core or fallback["core"],
            stack,
            layers,
        ) else "ready",
    }


def _layers_from_model_paths(raw_layers: Any, tree_paths: list[str]) -> list[dict[str, Any]]:
    layers: list[dict[str, Any]] = []
    for item in raw_layers or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:20]
        steps = []
        for step in item.get("steps") or []:
            if not isinstance(step, dict):
                continue
            path = str(step.get("path") or step.get("detail") or "").strip()
            if not path_on_tree(path, tree_paths):
                continue
            title = str(step.get("title") or _path_step(path))[:18]
            steps.append({"title": title, "detail": path[:80]})
        if name and steps:
            layers.append({"name": name, "steps": steps[:4]})
    return layers


def _decode_json(content: str) -> dict[str, Any]:
    clean = content.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", clean, flags=re.IGNORECASE).strip()
    try:
        payload = json.loads(clean)
    except json.JSONDecodeError as exc:
        raise ModelProviderError("invalid_structure", "模型未返回有效的项目结构") from exc
    if not isinstance(payload, dict):
        raise ModelProviderError("invalid_structure", "模型返回的项目结构格式无效")
    return payload


def _ground_model_briefing(
    payload: dict[str, Any],
    source: str,
    fallback: dict[str, Any],
    source_kind: str,
    description: str,
    code_excerpt: str,
) -> dict[str, Any]:
    lowered = source.lower()
    stack = [
        item.strip()
        for item in payload.get("stack") or []
        if isinstance(item, str) and item.strip() and item.strip().lower() in lowered
    ][:12]
    if not stack:
        stack = fallback["stack"]
    layers: list[dict[str, Any]] = []
    for item in payload.get("layers") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:20]
        steps = []
        for step in item.get("steps") or []:
            if not isinstance(step, dict):
                continue
            detail = str(step.get("detail") or step.get("title") or "").strip()
            if detail and detail.lower()[:12] in lowered:
                steps.append({"title": str(step.get("title") or detail)[:18], "detail": detail[:80]})
        if name and steps:
            layers.append({"name": name, "steps": steps[:4]})
    if not layers:
        layers = fallback["layers"]
    situation = str(payload.get("situation") or "").strip()
    if situation and situation[:8].lower() not in lowered:
        situation = fallback["situation"]
    core = str(payload.get("core") or "").strip()
    if core and core[:8].lower() not in lowered:
        core = fallback["core"]
    missing = [str(item) for item in payload.get("missing") or [] if str(item).strip()]
    return {
        **fallback,
        "source_kind": source_kind,
        "description": description[:8_000],
        "code_excerpt": code_excerpt[:20_000],
        "situation": (situation or fallback["situation"])[:240],
        "core": (core or fallback["core"])[:240],
        "stack": stack,
        "layers": layers,
        "mermaid": _mermaid_from_layers(fallback.get("situation") or "项目", layers),
        "missing": missing or _missing_parts(situation or fallback["situation"], core or fallback["core"], stack, layers),
        "generated_from": "model",
        "status": "needs_input" if (missing or _missing_parts(situation or fallback["situation"], core or fallback["core"], stack, layers)) else "ready",
    }

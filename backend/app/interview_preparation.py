from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections import OrderedDict
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

from .candidate_core import ProfileNotInitializedError, get_career_profile
from .db import connect, json_dump, row_to_dict
from .agent.settings import get_model_connection
from .config import get_settings
from .domain import AgentMessage, ModelRequest
from .models import ModelProviderError, OpenAICompatibleProvider
from .profile_intelligence import extract_skills


_RESUME_HEADINGS = {
    "个人信息", "个人简介", "教育经历", "工作经历", "项目经历", "实习经历",
    "专业技能", "技能", "荣誉奖项", "自我评价", "resume", "experience",
    "education", "skills", "projects",
}

_RECORDS_STATE_KEY = "_interview_records"
_RESUME_STRUCTURE_STATE_KEY = "_resume_structure"
_SELECTED_PROJECTS_STATE_KEY = "_selected_project_ids"
_JD_ANALYSIS_STATE_KEY = "_project_jd_analysis"
_RESUME_ANALYSIS_STATE_KEY = "_resume_structure_analysis"
_resume_analysis_tasks: set[asyncio.Task[None]] = set()
_PREPARATION_CACHE_LIMIT = 24
_preparation_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
_preparation_cache_lock = RLock()


def _preparation_cache_key(
    *,
    db_path: str | Path | None,
    profile_id: int,
    revision: int,
    state: dict[str, Any],
    resume_text: str,
    target_roles: list[str],
    facts: list[str],
) -> str:
    """Fingerprint every input that can affect a preparation response."""
    source = {
        "db": str(Path(db_path).resolve()) if db_path else "default",
        "profile_id": profile_id,
        "revision": revision,
        "state": state,
        "resume_text": resume_text,
        "target_roles": target_roles,
        "facts": facts,
    }
    serialized = json.dumps(source, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _cached_preparation(key: str) -> dict[str, Any] | None:
    with _preparation_cache_lock:
        cached = _preparation_cache.get(key)
        if cached is None:
            return None
        _preparation_cache.move_to_end(key)
        return deepcopy(cached)


def _cache_preparation(key: str, payload: dict[str, Any]) -> dict[str, Any]:
    with _preparation_cache_lock:
        _preparation_cache[key] = deepcopy(payload)
        _preparation_cache.move_to_end(key)
        while len(_preparation_cache) > _PREPARATION_CACHE_LIMIT:
            _preparation_cache.popitem(last=False)
    return payload


def get_interview_preparation(db_path: str | Path | None = None) -> dict[str, Any]:
    bundle = get_career_profile(db_path)
    profile = bundle["profile"]
    if profile is None:
        # A missing profile is a normal first-run state for this read endpoint,
        # not a service failure. Return a complete empty shape so every client
        # can present the same actionable onboarding screen.
        return {
            "has_profile": False,
            "profile": {"id": 0, "name": ""},
            "source_revision": 0,
            "stale": False,
            "has_resume": False,
            "overview": {"target_roles": [], "summary": ""},
            "resume_structure": None,
            "resume_analysis": {"status": "idle"},
            "experiences": [],
            "selected_project_ids": [],
            "job_analysis": None,
            "unclassified_fragments": [],
            "classified_fragment_count": 0,
            "ignored_fragment_count": 0,
            "review_items": [],
            "general_knowledge": [],
            "interview_records": [],
        }

    profile_id = int(profile["id"])
    revision = int(profile.get("knowledge_revision") or 0)
    state = _get_state(profile_id, db_path)
    resume_text = str(profile.get("resume_text") or "").strip()
    strategy = bundle.get("active_strategy") or {}
    target_roles = [str(item) for item in strategy.get("target_roles") or [] if str(item).strip()]
    facts = [str(item.get("statement") or "").strip() for item in bundle.get("facts") or []]
    cache_key = _preparation_cache_key(
        db_path=db_path,
        profile_id=profile_id,
        revision=revision,
        state=state,
        resume_text=resume_text,
        target_roles=target_roles,
        facts=facts,
    )
    cached = _cached_preparation(cache_key)
    if cached is not None:
        return cached
    node_state = state.get("node_state") or {}
    structure = _current_resume_structure(node_state, revision)
    resume_analysis = _resume_analysis_state(node_state, revision, bool(structure))
    project_blocks, raw_fragments = _project_blocks(resume_text, facts)
    fallback_projects = _fallback_project_blocks(resume_text)
    excerpt_candidates = _resume_excerpt_candidates(resume_text)
    triage_state = node_state.get("_project_triage") or {}
    ignored_fragment_ids = {
        fragment_id for fragment_id, decision in triage_state.items()
        if isinstance(decision, dict) and decision.get("action") == "ignore"
    }
    manual_project_blocks = [
        {"title": _experience_title(item["text"]), "evidence": item["text"]}
        for item in raw_fragments
        if isinstance(triage_state.get(item["id"]), dict)
        and triage_state[item["id"]].get("action") == "confirm_project"
    ]
    if structure:
        structured_projects = (
            structure["projects"]
            or _module_experience_candidates(structure["modules"])
            or fallback_projects
            or excerpt_candidates
        )
        experiences = [
            _experience_item(
                item["evidence"], index, node_state, title=item["title"], fields=item.get("fields") or [],
            )
            for index, item in enumerate(structured_projects)
        ]
        unclassified_fragments = []
        classified_fragment_count = structure["classified_fragment_count"]
    else:
        experiences = [
            _experience_item(item["evidence"], index, node_state, title=item["title"])
            for index, item in enumerate([*(project_blocks or fallback_projects or excerpt_candidates), *manual_project_blocks])
        ]
        unclassified_fragments = [
            {"id": item["id"], "text": item["text"], "decision": "pending"}
            for item in raw_fragments
            if item["id"] not in ignored_fragment_ids
            and not (isinstance(triage_state.get(item["id"]), dict) and triage_state[item["id"]].get("action") in {"confirm_project", "work_responsibility", "skill_evidence"})
        ]
        classified_fragment_count = sum(
            1 for decision in triage_state.values()
            if isinstance(decision, dict) and decision.get("action") in {"work_responsibility", "skill_evidence"}
        )
    review_items = [
        node
        for experience in experiences
        for group in (experience["questions"], experience["knowledge"], experience["gaps"])
        for node in group
        if not node.get("completed")
    ]
    general_knowledge = [
        _node(
            f"resume-skill-{skill.lower().replace(' ', '-')}",
            "knowledge",
            f"梳理 {skill} 的核心概念、实际用法和选型边界",
            node_state,
        )
        for skill in extract_skills(resume_text)[:8]
    ]
    records = _records_from_state(node_state)
    selected_project_ids = _selected_project_ids(node_state, experiences)
    job_analysis = _current_jd_analysis(node_state, revision, selected_project_ids)

    payload = {
        "has_profile": True,
        "profile": {"id": profile_id, "name": profile.get("name") or "我"},
        "source_revision": revision,
        "stale": bool(state) and int(state.get("knowledge_revision") or 0) != revision,
        "has_resume": bool(resume_text),
        "overview": {
            "target_roles": target_roles,
            "summary": _overview_summary(profile.get("name") or "你", target_roles, len(experiences)),
        },
        "resume_structure": structure,
        "resume_analysis": resume_analysis,
        "experiences": experiences,
        "selected_project_ids": selected_project_ids,
        "job_analysis": job_analysis,
        "unclassified_fragments": unclassified_fragments,
        "classified_fragment_count": classified_fragment_count,
        "ignored_fragment_count": len(ignored_fragment_ids),
        "review_items": review_items,
        "general_knowledge": general_knowledge,
        "interview_records": records,
    }
    return _cache_preparation(cache_key, payload)


async def analyze_interview_preparation_resume(
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Use the configured model to turn a saved resume into displayable modules.

    The result is revision-scoped and only retained after its JSON passes a
    deliberately small schema normalizer.  The original resume remains the
    evidence source; no model-created facts are written into the profile.
    """
    bundle = get_career_profile(db_path)
    profile = bundle["profile"]
    if profile is None:
        raise ProfileNotInitializedError("请先创建候选人画像")
    revision = int(profile.get("knowledge_revision") or 0)
    profile_id = int(profile["id"])
    state = _get_state(profile_id, db_path)
    node_state = dict(state.get("node_state") or {})
    if _current_resume_structure(node_state, revision):
        return get_interview_preparation(db_path)

    original = str(profile.get("resume_text") or "").strip()
    if not original:
        raise ValueError("请先保存简历，再进行 AI 整理")
    resume_text = original if profile.get("privacy_mode") == "original" else str(
        profile.get("resume_redacted_text") or original
    )
    connection = get_model_connection(db_path)
    if not connection["api_key"]:
        raise ValueError("请先在 Agent 设置中配置模型，再进行 AI 整理")

    node_state[_RESUME_ANALYSIS_STATE_KEY] = {
        **(node_state.get(_RESUME_ANALYSIS_STATE_KEY) or {}),
        "source_revision": revision,
        "status": "running",
        "phase": "calling_model",
    }
    _save_state(profile_id, revision, node_state, db_path)
    provider = OpenAICompatibleProvider(
        api_key=connection["api_key"],
        model=connection["model_name"],
        base_url=connection["model_base_url"] or None,
        timeout_seconds=min(get_settings().model_timeout_seconds, 30),
    )
    response = await provider.generate(ModelRequest(messages=[
        AgentMessage(role="system", content=(
            "你是简历结构化助手。只根据给出的简历原文归类，不补写任何事实。"
            "只返回 JSON，不要 Markdown。"
        )),
        AgentMessage(role="user", content=(
            "把下面的简历整理为模块和字段，供求职客户端直接展示。"
            "modules 至少覆盖原文中存在的基本信息、求职意向、工作经历、项目经历、技能、教育等模块；"
            "每个模块格式为 {key,label,fields:[{label,value}]}，字段内容应简洁。"
            "不要输出电话、手机号、邮箱、住址、身份证号、生日或其他联系方式与敏感个人信息。"
            "projects 只放明确的项目或产品交付，格式为 "
            "{title,evidence,fields:[{label,value}]}，fields 可使用项目背景、个人职责、技术方案、结果等标签。"
            "evidence 必须是简历中的原句或原句组合；没有明确项目则返回空数组。"
            "普通工作职责、技能、教育和个人信息必须归入 modules，不得作为项目。\n\n"
            f"简历原文：\n{resume_text[:16_000]}"
        )),
    ]))
    node_state[_RESUME_ANALYSIS_STATE_KEY]["phase"] = "validating_result"
    _save_state(profile_id, revision, node_state, db_path)
    structure = _normalise_resume_structure(_decode_json_response(response.content), original)
    node_state[_RESUME_STRUCTURE_STATE_KEY] = {
        "source_revision": revision,
        "modules": structure["modules"],
        "projects": structure["projects"],
        "classified_fragment_count": structure["classified_fragment_count"],
    }
    _save_state(profile_id, revision, node_state, db_path)
    return get_interview_preparation(db_path)


async def start_interview_preparation_resume_analysis(
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Start the slow model request in the background and return immediately."""
    bundle = get_career_profile(db_path)
    profile = bundle["profile"]
    if profile is None:
        raise ProfileNotInitializedError("请先创建候选人画像")
    profile_id = int(profile["id"])
    revision = int(profile.get("knowledge_revision") or 0)
    state = _get_state(profile_id, db_path)
    node_state = dict(state.get("node_state") or {})
    if _current_resume_structure(node_state, revision):
        return get_interview_preparation(db_path)
    current_status = _resume_analysis_state(node_state, revision, False)
    if current_status["status"] == "running":
        return get_interview_preparation(db_path)
    node_state[_RESUME_ANALYSIS_STATE_KEY] = {
        "source_revision": revision,
        "status": "running",
        "phase": "preparing_resume",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_state(profile_id, revision, node_state, db_path)

    task = asyncio.create_task(_run_resume_structure_analysis(db_path))
    _resume_analysis_tasks.add(task)
    task.add_done_callback(_resume_analysis_tasks.discard)
    return get_interview_preparation(db_path)


async def _run_resume_structure_analysis(db_path: str | Path | None) -> None:
    bundle = get_career_profile(db_path)
    profile = bundle["profile"]
    if profile is None:
        return
    profile_id = int(profile["id"])
    revision = int(profile.get("knowledge_revision") or 0)
    try:
        await analyze_interview_preparation_resume(db_path)
        status = {"source_revision": revision, "status": "completed", "phase": "completed"}
    except (ValueError, ModelProviderError) as exc:
        status = {"source_revision": revision, "status": "failed", "message": str(exc)[:240]}
    except Exception:
        status = {"source_revision": revision, "status": "failed", "message": "模型整理意外中断，请重试。"}
    state = _get_state(profile_id, db_path)
    node_state = dict(state.get("node_state") or {})
    # Ignore a task for an outdated resume revision.
    if int(state.get("knowledge_revision") or 0) != revision:
        return
    node_state[_RESUME_ANALYSIS_STATE_KEY] = status
    _save_state(profile_id, revision, node_state, db_path)


def select_interview_preparation_projects(
    project_ids: list[str], *, db_path: str | Path | None = None,
) -> dict[str, Any]:
    bundle = get_career_profile(db_path)
    profile = bundle["profile"]
    if profile is None:
        raise ProfileNotInitializedError("请先创建候选人画像")
    current = get_interview_preparation(db_path)
    available_ids = {item["id"] for item in current["experiences"]}
    selected = list(dict.fromkeys(str(item).strip() for item in project_ids if str(item).strip()))
    if any(item not in available_ids for item in selected):
        raise ValueError("项目候选已变化，请重新选择")
    profile_id = int(profile["id"])
    revision = int(profile.get("knowledge_revision") or 0)
    state = _get_state(profile_id, db_path)
    node_state = dict(state.get("node_state") or {})
    node_state[_SELECTED_PROJECTS_STATE_KEY] = selected
    # A different project set requires a new JD result even if the JD is unchanged.
    node_state.pop(_JD_ANALYSIS_STATE_KEY, None)
    _save_state(profile_id, revision, node_state, db_path)
    return get_interview_preparation(db_path)


async def analyze_interview_preparation_jd(
    job_description: str, *, db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Turn user-confirmed resume projects into JD-specific application material."""
    clean_jd = re.sub(r"\s+", " ", job_description).strip()
    if len(clean_jd) < 20:
        raise ValueError("请粘贴至少 20 个字符的目标 JD")
    bundle = get_career_profile(db_path)
    profile = bundle["profile"]
    if profile is None:
        raise ProfileNotInitializedError("请先创建候选人画像")
    current = get_interview_preparation(db_path)
    selected_ids = current["selected_project_ids"]
    if not selected_ids:
        raise ValueError("请先确认至少一个真实项目")
    selected_projects = [
        item for item in current["experiences"] if item["id"] in selected_ids
    ]
    revision = int(profile.get("knowledge_revision") or 0)
    profile_id = int(profile["id"])
    state = _get_state(profile_id, db_path)
    node_state = dict(state.get("node_state") or {})
    cached = _current_jd_analysis(node_state, revision, selected_ids)
    if cached and cached.get("job_description") == clean_jd:
        return current
    connection = get_model_connection(db_path)
    if not connection["api_key"]:
        raise ValueError("请先在 Agent 设置中配置模型，再进行 JD 分析")
    resume_text = str(profile.get("resume_text") or "")
    model_resume = resume_text if profile.get("privacy_mode") == "original" else str(
        profile.get("resume_redacted_text") or resume_text
    )
    provider = OpenAICompatibleProvider(
        api_key=connection["api_key"], model=connection["model_name"],
        base_url=connection["model_base_url"] or None,
        timeout_seconds=get_settings().model_timeout_seconds,
    )
    projects_for_prompt = [
        {"id": item["id"], "title": item["title"], "evidence": item["evidence"], "fields": item["fields"]}
        for item in selected_projects
    ]
    response = await provider.generate(ModelRequest(messages=[
        AgentMessage(role="system", content=(
            "你是求职材料教练。只依据给出的 JD 和简历项目证据，不能编造公司、规模、"
            "指标、技术或职责。只输出 JSON，不要 Markdown。"
        )),
        AgentMessage(role="user", content=(
            "为用户确认的项目生成针对目标 JD 的投递和面试材料。返回 JSON："
            "{summary:{fit,matched:[string],gaps:[string]},projects:[{id,rewrite,questions:[{id,question,focus}]}]}。"
            "rewrite 是可直接替换到简历的一段项目表述，保留事实边界；questions 是最可能的面试追问。"
            f"\nJD：\n{clean_jd[:12_000]}\n\n已确认项目：\n{json.dumps(projects_for_prompt, ensure_ascii=False)}"
            f"\n\n简历全文（只供核验）：\n{model_resume[:20_000]}"
        )),
    ]))
    analysis = _normalise_jd_analysis(
        _decode_json_response(response.content), clean_jd, selected_projects,
    )
    node_state[_JD_ANALYSIS_STATE_KEY] = {
        "source_revision": revision,
        "project_ids": selected_ids,
        **analysis,
    }
    _save_state(profile_id, revision, node_state, db_path)
    return get_interview_preparation(db_path)


async def give_interview_preparation_feedback(
    question_id: str, answer: str, *, db_path: str | Path | None = None,
) -> dict[str, Any]:
    clean_answer = answer.strip()
    if len(clean_answer) < 10:
        raise ValueError("请先写下至少一句回答，再获取反馈")
    current = get_interview_preparation(db_path)
    analysis = current.get("job_analysis") or {}
    questions = [
        question for project in analysis.get("projects") or [] for question in project.get("questions") or []
    ]
    question = next((item for item in questions if item.get("id") == question_id), None)
    if not question:
        raise ValueError("练习问题不存在或已过期")
    bundle = get_career_profile(db_path)
    profile = bundle["profile"]
    if profile is None:
        raise ProfileNotInitializedError("请先创建候选人画像")
    connection = get_model_connection(db_path)
    if not connection["api_key"]:
        raise ValueError("请先在 Agent 设置中配置模型，再获取回答反馈")
    provider = OpenAICompatibleProvider(
        api_key=connection["api_key"], model=connection["model_name"],
        base_url=connection["model_base_url"] or None,
        timeout_seconds=get_settings().model_timeout_seconds,
    )
    response = await provider.generate(ModelRequest(messages=[
        AgentMessage(role="system", content="你是严格、简洁的面试教练。只能基于提供的项目证据反馈，不得补写事实。只输出 JSON。"),
        AgentMessage(role="user", content=(
            "评估以下回答，返回 {strengths:[string],gaps:[string],next_attempt:string}。"
            f"\n问题：{question['question']}\n项目证据：{_project_evidence_for_question(current, question_id)}"
            f"\n用户回答：{clean_answer[:5_000]}"
        )),
    ]))
    feedback = _normalise_feedback(_decode_json_response(response.content))
    profile_id = int(profile["id"])
    revision = int(profile.get("knowledge_revision") or 0)
    state = _get_state(profile_id, db_path)
    node_state = dict(state.get("node_state") or {})
    node_state[f"feedback-{question_id}"] = {"answer": clean_answer[:5_000], "feedback": feedback}
    _save_state(profile_id, revision, node_state, db_path)
    return {"question_id": question_id, "answer": clean_answer, "feedback": feedback}


def review_interview_preparation_fragment(
    fragment_id: str,
    *,
    action: str,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if action not in {"confirm_project", "work_responsibility", "skill_evidence", "ignore"}:
        raise ValueError("片段分类无效")
    bundle = get_career_profile(db_path)
    profile = bundle["profile"]
    if profile is None:
        raise ProfileNotInitializedError("请先创建候选人画像")
    if not re.fullmatch(r"fragment-\d{1,6}", fragment_id):
        raise ValueError("待归类片段无效")

    resume_text = str(profile.get("resume_text") or "").strip()
    facts = [str(item.get("statement") or "").strip() for item in bundle.get("facts") or []]
    _, fragments = _project_blocks(resume_text, facts)
    if not any(item["id"] == fragment_id for item in fragments):
        raise ValueError("待归类片段不存在或已过期")

    profile_id = int(profile["id"])
    revision = int(profile.get("knowledge_revision") or 0)
    state = _get_state(profile_id, db_path)
    node_state = dict(state.get("node_state") or {})
    triage_state = dict(node_state.get("_project_triage") or {})
    triage_state[fragment_id] = {"action": action}
    node_state["_project_triage"] = triage_state
    _save_state(profile_id, revision, node_state, db_path)
    return get_interview_preparation(db_path)


def update_interview_preparation_node(
    node_id: str,
    *,
    completed: bool | None = None,
    note: str | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    bundle = get_career_profile(db_path)
    profile = bundle["profile"]
    if profile is None:
        raise ProfileNotInitializedError("请先创建候选人画像")
    if not re.fullmatch(r"[a-z0-9_-]{1,120}", node_id):
        raise ValueError("准备节点无效")

    profile_id = int(profile["id"])
    revision = int(profile.get("knowledge_revision") or 0)
    state = _get_state(profile_id, db_path)
    node_state = dict(state.get("node_state") or {})
    current = dict(node_state.get(node_id) or {})
    if completed is not None:
        current["completed"] = completed
    if note is not None:
        current["note"] = note.strip()[:2_000]
    node_state[node_id] = current
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO interview_preparation_state (profile_id, knowledge_revision, node_state_json)
            VALUES (?, ?, ?)
            ON CONFLICT(profile_id) DO UPDATE SET
                knowledge_revision = excluded.knowledge_revision,
                node_state_json = excluded.node_state_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (profile_id, revision, json_dump(node_state)),
        )
    return get_interview_preparation(db_path)


def add_interview_preparation_record(
    *,
    title: str,
    summary: str,
    occurred_on: str | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Persist a user-authored interview or text-practice reflection."""
    bundle = get_career_profile(db_path)
    profile = bundle["profile"]
    if profile is None:
        raise ProfileNotInitializedError("请先创建候选人画像")

    clean_title = title.strip()
    clean_summary = summary.strip()
    if not clean_title:
        raise ValueError("请填写这次面试或练习的主题")
    if not clean_summary:
        raise ValueError("请记录至少一条问题、回答或复盘内容")

    profile_id = int(profile["id"])
    revision = int(profile.get("knowledge_revision") or 0)
    state = _get_state(profile_id, db_path)
    node_state = dict(state.get("node_state") or {})
    records = _records_from_state(node_state)
    records.insert(0, {
        "id": f"record-{uuid4().hex}",
        "title": clean_title[:200],
        "summary": clean_summary[:10_000],
        "occurred_on": _normalise_occurred_on(occurred_on),
    })
    node_state[_RECORDS_STATE_KEY] = records[:100]
    _save_state(profile_id, revision, node_state, db_path)
    return get_interview_preparation(db_path)


def _get_state(profile_id: int, db_path: str | Path | None) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM interview_preparation_state WHERE profile_id = ?", (profile_id,)
        ).fetchone()
    return row_to_dict(row) or {}


def _save_state(
    profile_id: int,
    revision: int,
    node_state: dict[str, Any],
    db_path: str | Path | None,
) -> None:
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO interview_preparation_state (profile_id, knowledge_revision, node_state_json)
            VALUES (?, ?, ?)
            ON CONFLICT(profile_id) DO UPDATE SET
                knowledge_revision = excluded.knowledge_revision,
                node_state_json = excluded.node_state_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (profile_id, revision, json_dump(node_state)),
        )


def _records_from_state(node_state: dict[str, Any]) -> list[dict[str, str]]:
    raw_records = node_state.get(_RECORDS_STATE_KEY)
    if not isinstance(raw_records, list):
        return []
    records: list[dict[str, str]] = []
    for item in raw_records:
        if not isinstance(item, dict):
            continue
        record_id = str(item.get("id") or "").strip()
        title = str(item.get("title") or "").strip()
        summary = str(item.get("summary") or "").strip()
        occurred_on = str(item.get("occurred_on") or "").strip()
        if record_id and title and summary:
            records.append({
                "id": record_id[:120],
                "title": title[:200],
                "summary": summary[:10_000],
                "occurred_on": occurred_on[:20],
            })
    return records[:100]


def _normalise_occurred_on(value: str | None) -> str:
    if not value or not value.strip():
        return date.today().isoformat()
    try:
        return date.fromisoformat(value.strip()).isoformat()
    except ValueError as exc:
        raise ValueError("日期格式应为 YYYY-MM-DD") from exc


def _project_blocks(resume_text: str, facts: list[str]) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Conservatively extract only explicit project blocks; keep everything else reviewable."""
    lines = [re.sub(r"\s+", " ", line).strip() for line in resume_text.splitlines()]
    blocks: list[dict[str, str]] = []
    fragments: list[dict[str, str]] = []
    in_projects = False
    current_title = ""
    current_lines: list[str] = []

    def add_fragment(text: str, index: int) -> None:
        clean = text.strip()
        if not clean or clean.casefold().rstrip(":：") in _RESUME_HEADINGS:
            return
        if re.fullmatch(r"[\w.+-]+@[\w.-]+", clean) or re.fullmatch(r"[\d\s-]{8,}", clean):
            return
        fragments.append({"id": f"fragment-{index + 1}", "text": clean[:500]})

    def flush_project() -> None:
        nonlocal current_title, current_lines
        if not current_title:
            return
        evidence = "\n".join([current_title, *current_lines]).strip()
        blocks.append({"title": current_title[:200], "evidence": evidence[:2_000]})
        current_title = ""
        current_lines = []

    for index, line in enumerate(lines):
        if not line:
            continue
        normalized = line.casefold().rstrip(":：")
        if normalized in {"项目经历", "项目经验", "项目实践", "projects"}:
            flush_project()
            in_projects = True
            continue
        if normalized in _RESUME_HEADINGS or re.match(r"^(?:技能|专业技能|skills?)\s*[:：]", normalized):
            flush_project()
            in_projects = False
            if re.match(r"^(?:技能|专业技能|skills?)\s*[:：]", normalized):
                add_fragment(line, index)
            continue
        if not in_projects:
            add_fragment(line, index)
            continue
        if line.startswith(("-", "•", "·")):
            if current_title:
                current_lines.append(line)
            else:
                add_fragment(line, index)
            continue
        if current_title:
            flush_project()
        current_title = line

    flush_project()
    for fact in facts:
        add_fragment(fact, len(lines) + len(fragments))
    return blocks, fragments


def _fallback_project_blocks(resume_text: str) -> list[dict[str, Any]]:
    """Fast, conservative candidates when a resume has no standard project heading.

    PDF/Word extraction often loses headings.  This keeps the project page usable
    without pretending that every resume line is a project.
    """
    lines = [line.strip() for line in resume_text.splitlines() if line.strip()]
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, line in enumerate(lines):
        normalized = line.casefold()
        is_project_name = (
            "项目" in line
            or any(keyword in normalized for keyword in ("system", "platform", "assistant", "application", "app"))
        )
        is_non_project = (
            normalized.rstrip("：:") in _RESUME_HEADINGS
            or any(keyword in line for keyword in ("项目经历", "项目经验", "工作经历", "教育经历", "联系方式"))
            or "@" in line
            or bool(re.fullmatch(r"[\d\s./~-]+", line))
        )
        if not is_project_name or is_non_project:
            continue
        evidence_lines = [line]
        for following in lines[index + 1:index + 5]:
            if following.casefold().rstrip("：:") in _RESUME_HEADINGS:
                break
            if re.search(r"(?:公司|有限公司|工作经历|教育经历)\s*[|｜]", following):
                break
            evidence_lines.append(following)
            if len(evidence_lines) >= 4:
                break
        evidence = "\n".join(evidence_lines)[:2_000]
        key = re.sub(r"\s+", "", evidence)
        if key in seen:
            continue
        seen.add(key)
        candidates.append({"title": _experience_title(line), "evidence": evidence, "fields": []})
        if len(candidates) >= 12:
            break
    return candidates


def _module_experience_candidates(modules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the flow usable when the model created modules but no project list."""
    candidates: list[dict[str, Any]] = []
    for module in modules:
        if not isinstance(module, dict):
            continue
        label = str(module.get("label") or "").strip()
        if "教育" in label or not any(keyword in label for keyword in ("项目", "工作", "实习", "经历", "经验")):
            continue
        fields = [item for item in module.get("fields") or [] if isinstance(item, dict) and item.get("value")]
        if not fields:
            continue
        evidence = "\n".join(
            f"{str(item.get('label') or '简历内容').strip()}：{str(item['value']).strip()}"
            for item in fields
        )[:2_000]
        candidates.append({
            "title": f"{label}（待确认）",
            "evidence": evidence,
            "fields": [{"label": str(item.get("label") or "简历内容"), "value": str(item["value"])} for item in fields],
        })
        if len(candidates) >= 4:
            break
    return candidates


def _resume_excerpt_candidates(resume_text: str) -> list[dict[str, Any]]:
    """Last-resort, labelled candidates; users still decide whether they are projects."""
    lines = [line.strip() for line in resume_text.splitlines() if line.strip()]
    useful_lines = [
        line for line in lines
        if line.casefold().rstrip("：:") not in _RESUME_HEADINGS
        and "@" not in line
        and not re.fullmatch(r"(?:1\d{10}|\+?\d[\d\s-]{7,})", line)
    ]
    candidates: list[dict[str, Any]] = []
    for index in range(0, min(len(useful_lines), 16), 4):
        excerpt = useful_lines[index:index + 4]
        if len(excerpt) < 2:
            continue
        candidates.append({
            "title": f"简历经历片段 {len(candidates) + 1}（待确认）",
            "evidence": "\n".join(excerpt)[:2_000],
            "fields": [],
        })
        if len(candidates) >= 4:
            break
    return candidates


def _experience_item(
    evidence: str,
    index: int,
    node_state: dict[str, Any],
    *,
    title: str | None = None,
    fields: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    prefix = f"experience-{index + 1}"
    skills = extract_skills(evidence)
    questions = [
        _node(f"{prefix}-contribution", "question", "你在这段经历中具体负责什么？", node_state),
        _node(f"{prefix}-decision", "question", "为什么采用这样的做法？关键取舍是什么？", node_state),
        _node(f"{prefix}-result", "question", "这段经历带来了什么可验证的结果或影响？", node_state),
    ]
    knowledge = [
        _node(
            f"{prefix}-skill-{skill.lower().replace(' ', '-')}",
            "knowledge",
            f"梳理 {skill} 的核心概念、实际用法和选型边界",
            node_state,
        )
        for skill in skills[:4]
    ]
    if not knowledge:
        knowledge.append(_node(
            f"{prefix}-method", "knowledge", "梳理这段经历中使用的方法、流程与判断依据", node_state
        ))
    gaps = []
    if not re.search(r"\d|提升|降低|增长|节省|完成|交付", evidence):
        gaps.append(_node(
            f"{prefix}-evidence-gap", "gap", "补充一个可验证的结果、影响或反馈", node_state
        ))
    return {
        "id": prefix,
        "title": title or _experience_title(evidence),
        "evidence": evidence,
        "fields": fields or [],
        "questions": questions,
        "knowledge": knowledge,
        "gaps": gaps,
    }


def _node(node_id: str, kind: str, title: str, node_state: dict[str, Any]) -> dict[str, Any]:
    state = node_state.get(node_id) or {}
    return {
        "id": node_id,
        "kind": kind,
        "title": title,
        "completed": bool(state.get("completed")),
        "note": str(state.get("note") or ""),
    }


def _experience_title(evidence: str) -> str:
    return evidence[:34] + ("…" if len(evidence) > 34 else "")


def _overview_summary(name: str, target_roles: list[str], experience_count: int) -> str:
    role_copy = "、".join(target_roles[:2]) if target_roles else "目标岗位"
    if experience_count:
        return f"{name}，围绕 {role_copy}，从 {experience_count} 条真实经历开始梳理。"
    return f"{name}，先完善简历，再围绕 {role_copy} 梳理准备内容。"


def _current_resume_structure(node_state: dict[str, Any], revision: int) -> dict[str, Any] | None:
    raw = node_state.get(_RESUME_STRUCTURE_STATE_KEY)
    if not isinstance(raw, dict) or raw.get("source_revision") != revision:
        return None
    modules = raw.get("modules")
    projects = raw.get("projects")
    if not isinstance(modules, list) or not isinstance(projects, list):
        return None
    return {
        "modules": modules,
        "projects": projects,
        "classified_fragment_count": int(raw.get("classified_fragment_count") or 0),
    }


def _resume_analysis_state(
    node_state: dict[str, Any], revision: int, has_structure: bool,
) -> dict[str, str]:
    if has_structure:
        return {"status": "completed"}
    raw = node_state.get(_RESUME_ANALYSIS_STATE_KEY)
    if not isinstance(raw, dict) or raw.get("source_revision") != revision:
        return {"status": "idle"}
    status = str(raw.get("status") or "idle")
    if status not in {"running", "failed", "completed"}:
        return {"status": "idle"}
    if status == "running" and _resume_analysis_has_timed_out(raw.get("started_at")):
        return {"status": "failed", "message": "整理超过预期时长，可能被服务重载或模型请求中断；请重试。"}
    result = {"status": status}
    phase = str(raw.get("phase") or "")
    if phase in {"preparing_resume", "calling_model", "validating_result", "completed"}:
        result["phase"] = phase
    if status == "failed" and raw.get("message"):
        result["message"] = str(raw["message"])[:240]
    return result


def _resume_analysis_has_timed_out(value: Any) -> bool:
    if not isinstance(value, str):
        return True
    try:
        started_at = datetime.fromisoformat(value)
    except ValueError:
        return True
    if started_at.tzinfo is None:
        return True
    return datetime.now(timezone.utc) - started_at > timedelta(seconds=45)


def _selected_project_ids(node_state: dict[str, Any], experiences: list[dict[str, Any]]) -> list[str]:
    available = {item["id"] for item in experiences}
    raw = node_state.get(_SELECTED_PROJECTS_STATE_KEY)
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if str(item) in available]


def _current_jd_analysis(
    node_state: dict[str, Any], revision: int, selected_project_ids: list[str],
) -> dict[str, Any] | None:
    raw = node_state.get(_JD_ANALYSIS_STATE_KEY)
    if not isinstance(raw, dict):
        return None
    if raw.get("source_revision") != revision or raw.get("project_ids") != selected_project_ids:
        return None
    if not isinstance(raw.get("summary"), dict) or not isinstance(raw.get("projects"), list):
        return None
    return raw


def _normalise_jd_analysis(
    payload: dict[str, Any], job_description: str, projects: list[dict[str, Any]],
) -> dict[str, Any]:
    allowed_ids = {item["id"] for item in projects}
    summary_raw = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    summary = {
        "fit": _clean_structure_text(summary_raw.get("fit"), 60) or "需要补充证据",
        "matched": _clean_text_list(summary_raw.get("matched"), 8),
        "gaps": _clean_text_list(summary_raw.get("gaps"), 8),
    }
    normalized_projects: list[dict[str, Any]] = []
    for item in payload.get("projects") or []:
        if not isinstance(item, dict) or str(item.get("id") or "") not in allowed_ids:
            continue
        questions: list[dict[str, str]] = []
        for index, question in enumerate(item.get("questions") or []):
            if not isinstance(question, dict):
                continue
            text = _clean_structure_text(question.get("question"), 500)
            if not text:
                continue
            questions.append({
                "id": f"{item['id']}-jd-question-{index + 1}",
                "question": text,
                "focus": _clean_structure_text(question.get("focus"), 200),
            })
            if len(questions) >= 5:
                break
        normalized_projects.append({
            "id": str(item["id"]),
            "rewrite": _clean_structure_text(item.get("rewrite"), 2_000),
            "questions": questions,
        })
    # Keep every confirmed project visible, even when the model omits one.
    by_id = {item["id"]: item for item in normalized_projects}
    return {
        "job_description": job_description,
        "summary": summary,
        "projects": [by_id.get(item["id"], {"id": item["id"], "rewrite": "", "questions": []}) for item in projects],
    }


def _clean_text_list(value: Any, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for item in value if (text := _clean_structure_text(item, 500))][:limit]


def _project_evidence_for_question(current: dict[str, Any], question_id: str) -> str:
    project_id = question_id.split("-jd-question-", 1)[0]
    project = next((item for item in current.get("experiences") or [] if item.get("id") == project_id), {})
    evidence = str(project.get("evidence") or "").strip()
    fields = project.get("fields") or []
    field_text = "；".join(
        f"{item.get('label')}：{item.get('value')}"
        for item in fields if isinstance(item, dict) and item.get("value")
    )
    return "；".join(part for part in (evidence, field_text) if part)[:4_000] or "未提供额外项目证据"


def _normalise_feedback(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "strengths": _clean_text_list(payload.get("strengths"), 5),
        "gaps": _clean_text_list(payload.get("gaps"), 5),
        "next_attempt": _clean_structure_text(payload.get("next_attempt"), 1_500),
    }


def _decode_json_response(content: str) -> dict[str, Any]:
    clean = content.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", clean, flags=re.IGNORECASE).strip()
    try:
        payload = json.loads(clean)
    except json.JSONDecodeError as exc:
        raise ModelProviderError("invalid_structure", "模型未返回有效的简历结构数据") from exc
    if not isinstance(payload, dict):
        raise ModelProviderError("invalid_structure", "模型返回的简历结构格式无效")
    return payload


def _normalise_resume_structure(payload: dict[str, Any], original_resume: str) -> dict[str, Any]:
    modules: list[dict[str, Any]] = []
    for item in payload.get("modules") or []:
        if not isinstance(item, dict):
            continue
        label = _clean_structure_text(item.get("label"), 80)
        if not label:
            continue
        fields = _normalise_structure_fields(item.get("fields"))
        if fields:
            modules.append({
                "key": _clean_structure_text(item.get("key"), 40) or f"module-{len(modules) + 1}",
                "label": label,
                "fields": fields,
            })
        if len(modules) >= 12:
            break

    projects: list[dict[str, Any]] = []
    for item in payload.get("projects") or []:
        if not isinstance(item, dict):
            continue
        title = _clean_structure_text(item.get("title"), 200)
        evidence = _clean_structure_text(item.get("evidence"), 2_000)
        if not title or not evidence:
            continue
        # A project must remain traceable to the resume that the user saved.
        normalized_evidence = re.sub(r"\s+", " ", evidence).strip()
        normalized_resume = re.sub(r"\s+", " ", original_resume).strip()
        if normalized_evidence not in normalized_resume and not any(
            line.strip() and re.sub(r"\s+", " ", line).strip() in normalized_resume
            for line in evidence.splitlines()
        ):
            continue
        projects.append({
            "title": title,
            "evidence": evidence,
            "fields": _normalise_structure_fields(item.get("fields")),
        })
        if len(projects) >= 20:
            break
    if not modules and not projects:
        raise ModelProviderError("invalid_structure", "模型未识别出可展示的简历模块")
    nonempty_lines = sum(1 for line in original_resume.splitlines() if line.strip())
    return {
        "modules": modules,
        "projects": projects,
        "classified_fragment_count": nonempty_lines,
    }


def _normalise_structure_fields(raw_fields: Any) -> list[dict[str, str]]:
    if not isinstance(raw_fields, list):
        return []
    fields: list[dict[str, str]] = []
    for item in raw_fields:
        if not isinstance(item, dict):
            continue
        label = _clean_structure_text(item.get("label"), 80)
        value = _clean_structure_text(item.get("value"), 1_000)
        if label and value and not _is_private_contact_field(label, value):
            fields.append({"label": label, "value": value})
        if len(fields) >= 20:
            break
    return fields


def _clean_structure_text(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _is_private_contact_field(label: str, value: str) -> bool:
    normalized_label = label.casefold().replace(" ", "")
    if any(token in normalized_label for token in ("电话", "手机", "邮箱", "邮件", "联系方式", "住址", "地址", "身份证", "生日")):
        return True
    if re.search(r"[\w.+-]+@[\w.-]+", value):
        return True
    return bool(re.fullmatch(r"(?:\+?\d[\d\s-]{7,}\d)", value))

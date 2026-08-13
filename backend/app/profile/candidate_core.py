from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Literal

from . import document as profile_document
from .candidate_memory import (
    get_memory_item,
    is_memory_id,
    list_memory_items,
    merge_memory,
    propose_memory,
    review_memory,
)
from ..db import connect, json_dump, row_to_dict, rows_to_dicts
from ..knowledge import delete_document, index_document
from ..privacy import scan_and_redact
from .intelligence import extract_skills, suggest_profile_fields
from ..resume.parser import normalize_resume_text


class ProfileNotInitializedError(ValueError):
    """No candidate profile exists yet.

    A missing precondition, not a bad argument: the caller can recover by
    creating a profile. Subclasses ValueError so existing ``except ValueError``
    handlers (e.g. the REST layer's 422 mapping) keep working unchanged.
    """


FactStatus = Literal["pending", "confirmed", "disputed", "retracted"]
ContextScope = Literal[
    "triage", "match", "resume", "interview", "outreach", "coaching", "discovery"
]

FACT_STATUSES = {"pending", "confirmed", "disputed", "retracted"}
CONTEXT_SCOPES = {
    "triage", "match", "resume", "interview", "outreach", "coaching", "discovery"
}
PROFILE_INTERVIEW_PHASES = (
    "goals",
    "experience",
    "project",
    "decisions",
    "metrics",
    "hidden_assets",
    "narrative",
    "stories",
    "voice",
    "complete",
)

PROFILE_QUESTIONS = {
    "goals": "你当前最想争取的具体岗位是什么？请先说一个最优先方向。",
    "experience": "最近一段经历中，你承担的核心职责是什么？",
    "project": "这段经历里最能代表你能力的一个项目是什么？",
    "decisions": "在这个项目中，你亲自做过的关键决策或行动是什么？",
    "metrics": "这个项目产生了什么可核验结果？如果没有精确数字，也可以先说明影响范围。",
    "hidden_assets": "还有哪些没有写进简历的技能、证书、作品或副业项目？",
    "narrative": "如果用一句话解释你为什么适合目标岗位，你希望招聘方记住什么？",
    "stories": "请讲一个你遇到困难、采取行动并取得结果的真实案例。",
    "voice": "你希望简历和求职沟通呈现什么风格？也可以说出不希望出现的表达。",
    "complete": "本轮画像访谈已经覆盖主要信息。你想继续补证据，还是先确认待审核内容？",
}


# 画像存在文档里，所以只有一份，id 固定。保留整数 id 是为了让 33 个 REST 端点和
# 依赖 profile_id 的调用方不用改签名。
PROFILE_ID = 1


def _profile_response(document: profile_document.ProfileDocument) -> dict[str, Any]:
    """把文档还原成原先 ``profiles`` 表行的形状。"""
    resume_text = document.resume_text
    return {
        "id": PROFILE_ID,
        "name": document.name,
        "locale": document.locale,
        "privacy_mode": document.privacy_mode,
        "resume_text": resume_text,
        "resume_redacted_text": scan_and_redact(resume_text)[1] if resume_text else "",
        "resume_filename": "",
        "skills_json": "[]",
        "projects_json": "[]",
        "knowledge_revision": document.knowledge_revision,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
    }


def active_profile_id(db_path: str | Path | None = None) -> int | None:
    return PROFILE_ID if _load_or_migrate_profile(db_path) is not None else None


def _legacy_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    try:
        loaded = json.loads(str(value or "[]"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    return loaded if isinstance(loaded, list) else []


def _load_or_migrate_profile(
    db_path: str | Path | None = None,
) -> profile_document.ProfileDocument | None:
    """Load the document profile, upgrading a legacy SQLite profile once."""
    document = profile_document.load(db_path)
    if document is not None:
        return document
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM profiles ORDER BY updated_at DESC, id DESC LIMIT 1"
        ).fetchone()
    if row is None:
        return None
    legacy = dict(row)
    skills = [str(item).strip() for item in _legacy_list(legacy.get("skills_json")) if str(item).strip()]
    projects: list[str] = []
    for item in _legacy_list(legacy.get("projects_json")):
        if isinstance(item, dict):
            text = "：".join(
                part for part in (
                    str(item.get("name") or "").strip(),
                    str(item.get("summary") or item.get("description") or "").strip(),
                ) if part
            )
        else:
            text = str(item).strip()
        if text:
            projects.append(text)
    migrated = profile_document.save(
        profile_document.ProfileDocument(
            name=str(legacy.get("name") or profile_document.DEFAULT_PROFILE_NAME),
            locale=str(legacy.get("locale") or "zh-CN"),
            privacy_mode=str(legacy.get("privacy_mode") or "redacted"),
            knowledge_revision=max(int(legacy.get("knowledge_revision") or 0), 0),
            created_at=str(legacy.get("created_at") or ""),
            updated_at=str(legacy.get("updated_at") or ""),
            skills="\n".join(f"- {item}" for item in skills),
            projects="\n".join(f"- {item}" for item in projects),
            resume_text=str(legacy.get("resume_text") or ""),
        ),
        db_path,
    )
    _sync_profile_compat(migrated, db_path)
    return migrated


def _sync_profile_compat(
    document: profile_document.ProfileDocument,
    db_path: str | Path | None = None,
) -> None:
    """Mirror the document profile for legacy tables with profile foreign keys."""
    resume_text = document.resume_text
    redacted_text = scan_and_redact(resume_text)[1] if resume_text else ""
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO profiles (
                id, name, resume_text, resume_filename, resume_redacted_text,
                privacy_mode, skills_json, projects_json, locale, knowledge_revision
            ) VALUES (?, ?, ?, '', ?, ?, '[]', '[]', ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                resume_text = excluded.resume_text,
                resume_redacted_text = excluded.resume_redacted_text,
                privacy_mode = excluded.privacy_mode,
                locale = excluded.locale,
                knowledge_revision = excluded.knowledge_revision,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                PROFILE_ID,
                document.name,
                resume_text,
                redacted_text,
                document.privacy_mode,
                document.locale,
                document.knowledge_revision,
            ),
        )
    _sync_resume_knowledge(redacted_text, db_path)


def _sync_resume_knowledge(
    redacted_text: str,
    db_path: str | Path | None = None,
) -> None:
    """Keep the resume evidence index in step with the saved profile.

    Only redacted text is indexed: search_resume_evidence hands its results
    straight to the model.
    """
    if redacted_text.strip():
        index_document(
            "resume",
            PROFILE_ID,
            "候选人简历",
            redacted_text,
            db_path=db_path,
        )
    else:
        delete_document("resume", PROFILE_ID, db_path=db_path)


def _touch_profile_revision(
    db_path: str | Path | None = None,
) -> profile_document.ProfileDocument:
    document = profile_document.save(_require_document(db_path), db_path)
    _sync_profile_compat(document, db_path)
    return document


def create_or_update_profile(
    *,
    name: str,
    locale: str = "zh-CN",
    privacy_mode: str = "redacted",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("称呼不能为空")
    document = profile_document.update(
        db_path,
        name=clean_name[:100],
        locale=locale[:20] or "zh-CN",
        privacy_mode=privacy_mode,
    )
    _sync_profile_compat(document, db_path)
    return _profile_response(document)


DEFAULT_PROFILE_NAME = profile_document.DEFAULT_PROFILE_NAME


def ensure_profile(db_path: str | Path | None = None) -> int:
    """Return the active profile id, creating a placeholder profile if none exists.

    For write and onboarding paths only. Read paths must surface
    ``ProfileNotInitializedError`` instead of silently creating rows.
    """
    existing = active_profile_id(db_path)
    if existing is not None:
        return existing
    profile = create_or_update_profile(name=DEFAULT_PROFILE_NAME, db_path=db_path)
    return int(profile["id"])


def _require_document(
    db_path: str | Path | None = None,
) -> profile_document.ProfileDocument:
    document = _load_or_migrate_profile(db_path)
    if document is None:
        raise ProfileNotInitializedError("请先创建候选人画像")
    return document


def _require_profile(profile_id: int | None, db_path: str | Path | None = None) -> int:
    _sync_profile_compat(_require_document(db_path), db_path)
    return PROFILE_ID


def _bump_revision(profile_id: int, conn) -> int:
    """No-op shim.

    ``knowledge_revision`` is held in the profile document and increments on
    every document write. Strategy and story writes are stored in SQLite, so
    they do not mutate the profile document from this compatibility shim.
    """
    return 0


# 文档模型里没有独立的"资料来源"表：简历正文就是文档的一个小节，其他来源
# （聊天消息等）的内容本身已经写进对应小节。这里保留 source 这层概念，是为了
# 让依赖 source_id 做溯源的调用方（面试题回指、简历段落溯源）继续工作。
RESUME_SOURCE_ID = profile_document.SECTION_ID_STRIDE * len(profile_document.SECTIONS)


def create_candidate_source(
    *,
    source_type: str,
    title: str,
    content: str,
    profile_id: int | None = None,
    source_uri: str = "",
    attachment_id: str | None = None,
    conversation_id: int | None = None,
    message_id: int | None = None,
    privacy_mode: str = "redacted",
    allow_model_original: bool = False,
    metadata: dict[str, Any] | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    _require_document(db_path)
    clean_content = normalize_resume_text(content).strip()
    if not clean_content:
        raise ValueError("资料内容不能为空")
    if source_type == "resume":
        document = profile_document.update(db_path, resume_text=clean_content)
        _sync_profile_compat(document, db_path)
    else:
        document = profile_document.load(db_path) or profile_document.ProfileDocument()
    return _source_response(document, source_type=source_type, title=title)


def _source_response(
    document: profile_document.ProfileDocument,
    *,
    source_type: str = "resume",
    title: str = "",
) -> dict[str, Any]:
    """来源记录的形状与原先一致，但正文不外泄（原先也只回长度）。"""
    text = document.resume_text
    return {
        "id": RESUME_SOURCE_ID,
        "profile_id": PROFILE_ID,
        "source_type": source_type,
        "title": title.strip()[:255] or "画像文档",
        "source_uri": "",
        "attachment_id": None,
        "conversation_id": None,
        "message_id": None,
        "content_hash": sha256(text.encode("utf-8")).hexdigest() if text else "",
        "privacy_mode": document.privacy_mode,
        "allow_model_original": document.privacy_mode == "original",
        "parse_status": "ready",
        "metadata_json": "{}",
        "character_count": len(text),
        "created_at": document.created_at,
        "updated_at": document.updated_at,
    }


def list_candidate_sources(
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    document = _require_document(db_path)
    if not document.resume_text.strip():
        return []
    return [_source_response(document, title="简历原文")]


def update_candidate_source_access(
    source_id: int,
    *,
    allow_model_original: bool,
    privacy_mode: Literal["redacted", "original"] | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Update the model-access grant. Now a document-level privacy setting."""
    _require_document(db_path)
    next_privacy_mode = privacy_mode or ("original" if allow_model_original else "redacted")
    document = profile_document.update(db_path, privacy_mode=next_privacy_mode)
    _sync_profile_compat(document, db_path)
    return _source_response(document, title="简历原文")


def propose_fact(
    *,
    category: str,
    statement: str,
    profile_id: int | None = None,
    canonical_key: str = "",
    value: dict[str, Any] | None = None,
    sensitivity: str = "private",
    confidence: float = 0.0,
    source_id: int | None = None,
    excerpt: str = "",
    locator: str = "",
    extraction_method: str = "user_statement",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    _require_document(db_path)
    return propose_memory(
        profile_id=PROFILE_ID,
        category=category,
        statement=statement,
        canonical_key=canonical_key,
        value=value,
        sensitivity=sensitivity,
        confidence=confidence,
        source_id=source_id,
        excerpt=excerpt,
        locator=locator,
        source_kind=extraction_method,
        db_path=db_path,
    )


def ingest_resume_knowledge(
    *,
    source_id: int,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    document = _require_document(db_path)
    text = (
        scan_and_redact(document.resume_text)[1]
        if document.privacy_mode == "redacted"
        else document.resume_text
    )
    suggestions = suggest_profile_fields(text)
    proposed: list[dict[str, Any]] = []
    for skill in extract_skills(text):
        proposed.append(
            propose_fact(
                category="skill",
                statement=f"具备 {skill} 相关经验",
                value={"name": skill},
                source_id=source_id,
                excerpt=skill,
                extraction_method="resume_parser",
                confidence=0.8,
                db_path=db_path,
            )
        )
    for line in text.splitlines():
        clean = " ".join(line.strip(" -•\t").split())
        if len(clean) < 12 or len(clean) > 500:
            continue
        if re.search(r"\d+(?:\.\d+)?\s*%|[$￥¥€£]\s*\d|\d+\s*[万亿千kKmM+]", clean):
            proposed.append(
                propose_fact(
                    category="achievement",
                    statement=clean,
                    source_id=source_id,
                    excerpt=clean,
                    extraction_method="resume_parser",
                    confidence=0.8,
                    db_path=db_path,
                )
            )
    if suggestions.get("target_roles"):
        ensure_default_strategy(
            PROFILE_ID, target_roles=suggestions["target_roles"], db_path=db_path
        )
    return proposed


def remove_fact(fact_id: int, db_path: str | Path | None = None) -> bool:
    """从画像文档里删掉一条内容。返回是否真的删掉了。

    取代原先的 review_fact(status="retracted")：文档模型下"不要这条"就是删除，
    不需要保留撤回状态。
    """
    if is_memory_id(fact_id):
        existing = get_memory_item(fact_id, db_path=db_path)
        if existing is None or existing.get("status") == "retracted":
            return False
        try:
            review_memory(fact_id, action="retract", db_path=db_path)
        except ValueError:
            return False
        if existing.get("status") == "confirmed":
            _touch_profile_revision(db_path)
        return True
    document = _require_document(db_path)
    target = next((item for item in document.facts() if item["id"] == fact_id), None)
    if target is None:
        return False
    section = target["section"]
    kept = [
        line
        for line in document.entries(section)
        if line != target["statement"]
    ]
    updated = profile_document.save(
        document.model_copy(
            update={section: "\n".join(f"- {line}" for line in kept)}
        ),
        db_path,
    )
    _sync_profile_compat(updated, db_path)
    return True


def list_facts(
    *,
    profile_id: int | None = None,
    status: str | None = None,
    category: str | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    document = _require_document(db_path)
    if status and status not in FACT_STATUSES:
        raise ValueError("事实状态不合法")
    document_items = [{**item, "status": "confirmed", "memory_item": False} for item in document.facts()]
    memory_status = {
        "pending": "proposed",
        "confirmed": "confirmed",
        "disputed": "rejected",
        "retracted": "retracted",
    }.get(status or "")
    memory_items = list_memory_items(
        profile_id=PROFILE_ID,
        status=memory_status or None,
        category=category,
        db_path=db_path,
    )
    if status in {"pending", "disputed", "retracted"}:
        return memory_items
    if status is None:
        memory_items = [
            item for item in memory_items
            if item.get("status") in {"pending", "confirmed"}
        ]
    items = document_items + memory_items
    if status == "confirmed":
        items = [item for item in items if item.get("status") == "confirmed"]
    if category:
        items = [item for item in items if item["category"] == category]
    return items


def review_fact(
    fact_id: int,
    *,
    status: FactStatus,
    statement: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Review a proposed memory item or safely update a document baseline fact."""
    if status not in FACT_STATUSES:
        raise ValueError("事实状态不合法")
    if is_memory_id(fact_id):
        before = get_memory_item(fact_id, db_path=db_path)
        action = {
            "pending": "confirm",
            "confirmed": "confirm",
            "disputed": "reject",
            "retracted": "retract",
        }[status]
        if statement.strip():
            action = "edit"
        reviewed = review_memory(
            fact_id, action=action, statement=statement, db_path=db_path
        )
        before_confirmed = bool(before and before.get("status") == "confirmed")
        after_confirmed = reviewed.get("status") == "confirmed"
        if before_confirmed != after_confirmed or (
            before_confirmed and after_confirmed and action == "edit"
        ):
            _touch_profile_revision(db_path)
        return reviewed

    document = _require_document(db_path)
    target = next((item for item in document.facts() if item["id"] == fact_id), None)
    if target is None:
        raise ValueError("事实不存在")
    if status in {"disputed", "retracted"}:
        remove_fact(fact_id, db_path)
        return {**target, "status": "retracted"}
    if statement.strip():
        section = target["section"]
        replacement = " ".join(statement.split())
        lines = [
            replacement if line == target["statement"] else line
            for line in document.entries(section)
        ]
        saved = profile_document.save(
            document.model_copy(update={section: "\n".join(f"- {line}" for line in lines)}),
            db_path,
        )
        _sync_profile_compat(saved, db_path)
        updated = _require_document(db_path)
        target = next(
            item for item in updated.facts()
            if item["section"] == section and item["statement"] == replacement
        )
    return {**target, "status": "confirmed"}


def merge_facts(
    source_fact_id: int,
    target_fact_id: int,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if not is_memory_id(source_fact_id) or not is_memory_id(target_fact_id):
        raise ValueError("只能合并待审核记忆条目")
    source = get_memory_item(source_fact_id, db_path=db_path)
    merged = merge_memory(source_fact_id, target_fact_id, db_path=db_path)
    if source and source.get("status") == "confirmed":
        _touch_profile_revision(db_path)
    return merged



def ensure_default_strategy(
    profile_id: int,
    *,
    target_roles: list[str] | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT * FROM career_strategies
            WHERE profile_id = ? ORDER BY is_active DESC, priority DESC, id LIMIT 1
            """,
            (profile_id,),
        ).fetchone()
        if row is None:
            cursor = conn.execute(
                """
                INSERT INTO career_strategies (
                    profile_id, name, target_roles_json, priority, is_active
                ) VALUES (?, ?, ?, 100, 1)
                """,
                (
                    profile_id,
                    (target_roles or ["主要求职方向"])[0][:100],
                    json_dump(target_roles or []),
                ),
            )
            _bump_revision(profile_id, conn)
            row = conn.execute(
                "SELECT * FROM career_strategies WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
    return row_to_dict(row) or {}


def create_strategy(
    *,
    name: str,
    target_roles: list[str],
    profile_id: int | None = None,
    seniority: str = "",
    market: str = "cn",
    locations: list[str] | None = None,
    salary: dict[str, Any] | None = None,
    work_modes: list[str] | None = None,
    industries: list[str] | None = None,
    hard_constraints: list[str] | None = None,
    soft_preferences: list[str] | None = None,
    blocked_companies: list[str] | None = None,
    blocked_keywords: list[str] | None = None,
    title_expansions: list[str] | None = None,
    evaluation_weights: dict[str, float] | None = None,
    priority: int = 0,
    is_active: bool = False,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    resolved = _require_profile(profile_id, db_path)
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("职业策略名称不能为空")
    with connect(db_path) as conn:
        if is_active:
            conn.execute("UPDATE career_strategies SET is_active = 0 WHERE profile_id = ?", (resolved,))
        cursor = conn.execute(
            """
            INSERT INTO career_strategies (
                profile_id, name, target_roles_json, seniority, market,
                locations_json, salary_json, work_modes_json, industries_json,
                hard_constraints_json, soft_preferences_json,
                blocked_companies_json, blocked_keywords_json, title_expansions_json,
                evaluation_weights_json, priority, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                resolved,
                clean_name[:100],
                json_dump(target_roles),
                seniority[:100],
                market[:20] or "cn",
                json_dump(locations or []),
                json_dump(salary or {}),
                json_dump(work_modes or []),
                json_dump(industries or []),
                json_dump(hard_constraints or []),
                json_dump(soft_preferences or []),
                json_dump(blocked_companies or []),
                json_dump(blocked_keywords or []),
                json_dump(title_expansions or []),
                json_dump(evaluation_weights or {}),
                int(priority),
                int(is_active),
            ),
        )
        _bump_revision(resolved, conn)
        row = conn.execute("SELECT * FROM career_strategies WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return row_to_dict(row) or {}


def list_strategies(
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    resolved = _require_profile(profile_id, db_path)
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT * FROM career_strategies
            WHERE profile_id = ? ORDER BY is_active DESC, priority DESC, id
            """,
            (resolved,),
        ).fetchall()
    return rows_to_dicts(rows)


def update_strategy(
    strategy_id: int,
    updates: dict[str, Any],
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    allowed_scalars = {"name", "seniority", "market", "priority", "is_active"}
    json_fields = {
        "target_roles", "locations", "salary", "work_modes", "industries",
        "hard_constraints", "soft_preferences", "blocked_companies", "blocked_keywords",
        "title_expansions", "evaluation_weights",
    }
    sets: list[str] = []
    values: list[Any] = []
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM career_strategies WHERE id = ?", (strategy_id,)).fetchone()
        if row is None:
            raise ValueError("职业策略不存在")
        profile_id = int(row["profile_id"])
        if updates.get("is_active"):
            conn.execute("UPDATE career_strategies SET is_active = 0 WHERE profile_id = ?", (profile_id,))
        for key, value in updates.items():
            if key in allowed_scalars:
                sets.append(f"{key} = ?")
                values.append(int(value) if key == "is_active" else value)
            elif key in json_fields:
                sets.append(f"{key}_json = ?")
                values.append(json_dump(value))
        if sets:
            conn.execute(
                f"UPDATE career_strategies SET {', '.join(sets)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (*values, strategy_id),
            )
            _bump_revision(profile_id, conn)
        updated = conn.execute("SELECT * FROM career_strategies WHERE id = ?", (strategy_id,)).fetchone()
    return row_to_dict(updated) or {}


def create_story(
    *,
    title: str,
    profile_id: int | None = None,
    strategy_id: int | None = None,
    strategy_ids: list[int] | None = None,
    situation: str = "",
    task: str = "",
    action: str = "",
    result: str = "",
    reflection: str = "",
    competencies: list[str] | None = None,
    applicable_questions: list[str] | None = None,
    fact_ids: list[int] | None = None,
    status: FactStatus = "pending",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    resolved = _require_profile(profile_id, db_path)
    if status not in FACT_STATUSES:
        raise ValueError("故事状态不合法")
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO candidate_stories (
                profile_id, strategy_id, title, situation, task, action, result,
                reflection, competencies_json, applicable_questions_json, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                resolved, strategy_id, title.strip()[:200], situation.strip(), task.strip(),
                action.strip(), result.strip(), reflection.strip(),
                json_dump(competencies or []), json_dump(applicable_questions or []), status,
            ),
        )
        story_id = int(cursor.lastrowid)
        for fact_id in dict.fromkeys(fact_ids or []):
            conn.execute(
                "INSERT OR IGNORE INTO candidate_story_facts (story_id, fact_id) VALUES (?, ?)",
                (story_id, fact_id),
            )
        for linked_strategy_id in dict.fromkeys(
            [item for item in (strategy_ids or []) if item] + ([strategy_id] if strategy_id else [])
        ):
            conn.execute(
                "INSERT OR IGNORE INTO candidate_story_strategies (story_id, strategy_id) VALUES (?, ?)",
                (story_id, linked_strategy_id),
            )
        if status == "confirmed":
            _bump_revision(resolved, conn)
        row = conn.execute("SELECT * FROM candidate_stories WHERE id = ?", (story_id,)).fetchone()
    return _story_response(row, db_path)


def _story_response(row, db_path: str | Path | None = None) -> dict[str, Any]:
    story = row_to_dict(row) or {}
    if not story:
        return story
    with connect(db_path) as conn:
        fact_ids = [
            int(row["fact_id"])
            for row in conn.execute(
                "SELECT fact_id FROM candidate_story_facts WHERE story_id = ? ORDER BY fact_id",
                (story["id"],),
            ).fetchall()
        ]
        strategy_rows = conn.execute(
            "SELECT strategy_id FROM candidate_story_strategies WHERE story_id = ? ORDER BY strategy_id",
            (story["id"],),
        ).fetchall()
    # 事实现在来自画像文档，按 id 回查。
    document = profile_document.load(db_path)
    by_id = {item["id"]: item for item in (document.facts() if document else [])}
    story["facts"] = [by_id[fact_id] for fact_id in fact_ids if fact_id in by_id]
    story["strategy_ids"] = [int(item["strategy_id"]) for item in strategy_rows]
    return story


def list_stories(
    *,
    profile_id: int | None = None,
    status: str | None = None,
    strategy_id: int | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    resolved = _require_profile(profile_id, db_path)
    clauses = ["profile_id = ?"]
    values: list[Any] = [resolved]
    if status:
        clauses.append("status = ?")
        values.append(status)
    if strategy_id is not None:
        clauses.append(
            "(strategy_id IS NULL OR strategy_id = ? OR EXISTS ("
            "SELECT 1 FROM candidate_story_strategies css "
            "WHERE css.story_id = candidate_stories.id AND css.strategy_id = ?))"
        )
        values.extend((strategy_id, strategy_id))
    with connect(db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM candidate_stories WHERE {' AND '.join(clauses)} ORDER BY id DESC",
            values,
        ).fetchall()
    return [_story_response(row, db_path) for row in rows]


def review_story(
    story_id: int,
    status: FactStatus,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if status not in FACT_STATUSES:
        raise ValueError("故事状态不合法")
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM candidate_stories WHERE id = ?", (story_id,)).fetchone()
        if row is None:
            raise ValueError("STAR 故事不存在")
        conn.execute(
            "UPDATE candidate_stories SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, story_id),
        )
        if row["status"] != status:
            _bump_revision(int(row["profile_id"]), conn)
        updated = conn.execute("SELECT * FROM candidate_stories WHERE id = ?", (story_id,)).fetchone()
    return _story_response(updated, db_path)


def get_voice_profile(
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    resolved = _require_profile(profile_id, db_path)
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM voice_profiles WHERE profile_id = ? ORDER BY is_active DESC, id DESC LIMIT 1",
            (resolved,),
        ).fetchone()
    return row_to_dict(row)


def save_voice_profile(
    *,
    profile_id: int | None = None,
    name: str = "默认表达风格",
    tone_rules: list[str] | None = None,
    banned_phrases: list[str] | None = None,
    warning_phrases: list[str] | None = None,
    formatting_rules: list[str] | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    resolved = _require_profile(profile_id, db_path)
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT id FROM voice_profiles WHERE profile_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1",
            (resolved,),
        ).fetchone()
        values = (
            name.strip()[:100] or "默认表达风格",
            json_dump(tone_rules or []),
            json_dump(banned_phrases or []),
            json_dump(warning_phrases or []),
            json_dump(formatting_rules or []),
        )
        if row is None:
            cursor = conn.execute(
                """
                INSERT INTO voice_profiles (
                    profile_id, name, tone_rules_json, banned_phrases_json,
                    warning_phrases_json, formatting_rules_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (resolved, *values),
            )
            voice_id = int(cursor.lastrowid)
        else:
            voice_id = int(row["id"])
            conn.execute(
                """
                UPDATE voice_profiles
                SET name = ?, tone_rules_json = ?, banned_phrases_json = ?,
                    warning_phrases_json = ?, formatting_rules_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (*values, voice_id),
            )
        _bump_revision(resolved, conn)
        updated = conn.execute("SELECT * FROM voice_profiles WHERE id = ?", (voice_id,)).fetchone()
    return row_to_dict(updated) or {}


def save_candidate_narrative(
    *,
    strategy_id: int | None = None,
    headline: str = "",
    transition_story: str = "",
    strengths: list[str] | None = None,
    risk_explanations: list[str] | None = None,
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    resolved = _require_profile(profile_id, db_path)
    with connect(db_path) as conn:
        existing = conn.execute(
            """
            SELECT * FROM candidate_narratives
            WHERE profile_id = ? AND ((strategy_id IS NULL AND ? IS NULL) OR strategy_id = ?)
              AND status != 'retracted' ORDER BY id DESC LIMIT 1
            """,
            (resolved, strategy_id, strategy_id),
        ).fetchone()
        payload = (
            headline.strip()[:500], transition_story.strip()[:10000],
            json_dump(strengths or []), json_dump(risk_explanations or []),
        )
        if existing is None:
            cursor = conn.execute(
                """
                INSERT INTO candidate_narratives (
                    profile_id, strategy_id, headline, transition_story,
                    strengths_json, risk_explanations_json, status
                ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
                """,
                (resolved, strategy_id, *payload),
            )
            narrative_id = int(cursor.lastrowid)
        else:
            narrative_id = int(existing["id"])
            conn.execute(
                """
                UPDATE candidate_narratives
                SET headline = ?, transition_story = ?, strengths_json = ?,
                    risk_explanations_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (*payload, narrative_id),
            )
        row = conn.execute("SELECT * FROM candidate_narratives WHERE id = ?", (narrative_id,)).fetchone()
    return row_to_dict(row) or {}


def list_candidate_narratives(
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    resolved = _require_profile(profile_id, db_path)
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM candidate_narratives WHERE profile_id = ? ORDER BY strategy_id, id DESC",
            (resolved,),
        ).fetchall()
    return rows_to_dicts(rows)


def review_candidate_narrative(
    narrative_id: int,
    status: FactStatus,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if status not in FACT_STATUSES:
        raise ValueError("职业叙事状态不合法")
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM candidate_narratives WHERE id = ?", (narrative_id,)).fetchone()
        if row is None:
            raise ValueError("职业叙事不存在")
        conn.execute(
            "UPDATE candidate_narratives SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, narrative_id),
        )
        if row["status"] != status:
            _bump_revision(int(row["profile_id"]), conn)
        updated = conn.execute("SELECT * FROM candidate_narratives WHERE id = ?", (narrative_id,)).fetchone()
    return row_to_dict(updated) or {}


def set_strategy_evidence(
    strategy_id: int,
    *,
    relationship: Literal["supports", "gap", "risk"],
    fact_id: int | None = None,
    weight: float = 1.0,
    note: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if relationship not in {"supports", "gap", "risk"}:
        raise ValueError("策略证据关系不合法")
    with connect(db_path) as conn:
        strategy = conn.execute("SELECT * FROM career_strategies WHERE id = ?", (strategy_id,)).fetchone()
        if strategy is None:
            raise ValueError("职业策略不存在")
        cursor = conn.execute(
            """
            INSERT INTO strategy_evidence (strategy_id, fact_id, relationship, weight, note)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(strategy_id, fact_id, relationship)
            DO UPDATE SET weight = excluded.weight, note = excluded.note
            """,
            (strategy_id, fact_id, relationship, max(0.0, min(float(weight), 10.0)), note.strip()[:2000]),
        )
        evidence_id = int(cursor.lastrowid or conn.execute(
            "SELECT id FROM strategy_evidence WHERE strategy_id = ? AND fact_id IS ? AND relationship = ?",
            (strategy_id, fact_id, relationship),
        ).fetchone()["id"])
        _bump_revision(int(strategy["profile_id"]), conn)
        row = conn.execute("SELECT * FROM strategy_evidence WHERE id = ?", (evidence_id,)).fetchone()
    return row_to_dict(row) or {}


def list_strategy_evidence(
    strategy_id: int,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT * FROM strategy_evidence
            WHERE strategy_id = ? ORDER BY relationship, weight DESC, id
            """,
            (strategy_id,),
        ).fetchall()
    items = rows_to_dicts(rows)
    document = profile_document.load(db_path)
    by_id = {item["id"]: item for item in (document.facts() if document else [])}
    for item in items:
        fact = by_id.get(int(item["fact_id"])) if item.get("fact_id") else None
        item["statement"] = fact["statement"] if fact else ""
        item["fact_status"] = "confirmed" if fact else None
    return items


def add_writing_sample(
    *,
    title: str,
    content: str,
    sample_type: str = "general",
    source_id: int | None = None,
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    resolved = _require_profile(profile_id, db_path)
    if not content.strip():
        raise ValueError("写作样本文本不能为空")
    with connect(db_path) as conn:
        cursor = conn.execute(
            "INSERT INTO writing_samples (profile_id, source_id, title, content, sample_type) VALUES (?, ?, ?, ?, ?)",
            (resolved, source_id, title.strip()[:255], content.strip()[:50000], sample_type[:50]),
        )
        _bump_revision(resolved, conn)
        row = conn.execute("SELECT * FROM writing_samples WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return row_to_dict(row) or {}


def list_writing_samples(
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    resolved = _require_profile(profile_id, db_path)
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM writing_samples WHERE profile_id = ? ORDER BY id DESC",
            (resolved,),
        ).fetchall()
    return rows_to_dicts(rows)


def get_candidate_context(
    scope: ContextScope,
    *,
    profile_id: int | None = None,
    strategy_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if scope not in CONTEXT_SCOPES:
        raise ValueError("候选人上下文范围不合法")
    resolved = _require_profile(profile_id, db_path)
    document = _require_document(db_path)
    with connect(db_path) as conn:
        if strategy_id is None:
            strategy_row = conn.execute(
                """
                SELECT * FROM career_strategies WHERE profile_id = ?
                ORDER BY is_active DESC, priority DESC, id LIMIT 1
                """,
                (resolved,),
            ).fetchone()
        else:
            strategy_row = conn.execute(
                "SELECT * FROM career_strategies WHERE id = ? AND profile_id = ?",
                (strategy_id, resolved),
            ).fetchone()

    # 不再缓存：文档每次直接读盘，没有需要失效的快照。
    profile = _profile_response(document)
    strategy = row_to_dict(strategy_row) if strategy_row else None
    confirmed = list_facts(profile_id=resolved, status="confirmed", db_path=db_path)
    pending = list_facts(profile_id=resolved, status="pending", db_path=db_path)
    retracted = list_facts(profile_id=resolved, status="retracted", db_path=db_path)

    def fact_item(item: dict[str, Any], include_evidence: bool = True) -> dict[str, Any]:
        result = {
            "id": item["id"],
            "category": item["category"],
            "statement": item["statement"],
            "value": item.get("value", {}),
            "sensitivity": item.get("sensitivity", "private"),
        }
        if include_evidence:
            result["evidence"] = [
                {
                    "source_id": evidence["source_id"],
                    "source_title": evidence.get("source_title", ""),
                    "excerpt": evidence["excerpt"],
                }
                for evidence in item.get("evidence", [])[:3]
            ]
        return result

    selected = confirmed
    if scope == "triage":
        proof_categories = {"achievement", "project", "experience", "credential", "skill"}
        selected = [item for item in confirmed if item["category"] in proof_categories][:12]
    elif scope == "discovery":
        selected = [item for item in confirmed if item["category"] in {"skill", "experience", "achievement"}][:20]
    elif scope == "outreach":
        selected = [item for item in confirmed if item.get("sensitivity") == "public"][:20]

    context: dict[str, Any] = {
        "profile": {
            "id": resolved,
            "name": profile.get("name", ""),
            "locale": profile.get("locale", "zh-CN"),
            "knowledge_revision": profile.get("knowledge_revision", 1),
        },
        "scope": scope,
        "strategy": strategy,
        "confirmed_facts": [fact_item(item, scope not in {"triage", "discovery"}) for item in selected],
        "blocked_claims": [item["statement"] for item in retracted],
    }
    if scope in {"coaching", "match"}:
        context["pending_hints"] = [fact_item(item) for item in pending[:30]]
        context["pending_usage_rule"] = "仅用于追问和潜在证据提示，不得计入正式匹配分或对外内容"
    if scope == "interview":
        context["stories"] = list_stories(
            profile_id=resolved, status="confirmed", strategy_id=strategy_id, db_path=db_path
        )
    if scope in {"resume", "interview", "outreach"}:
        context["voice"] = get_voice_profile(resolved, db_path)
        context["writing_samples"] = [
            {"id": item["id"], "title": item["title"], "sample_type": item["sample_type"], "content": item["content"][:3000]}
            for item in list_writing_samples(resolved, db_path)[:5]
        ]
    if scope in {"resume", "interview", "coaching"}:
        context["narratives"] = [
            item for item in list_candidate_narratives(resolved, db_path)
            if item["status"] == "confirmed" and (
                item.get("strategy_id") is None
                or not strategy
                or item.get("strategy_id") == strategy.get("id")
            )
        ]
    canonical = json.dumps(context, ensure_ascii=False, sort_keys=True)
    context["fingerprint"] = sha256(canonical.encode("utf-8")).hexdigest()
    return context


_METRIC_PATTERNS = (
    re.compile(r"\d+(?:\.\d+)?\s*%"),
    re.compile(r"[$￥¥€£]\s*\d[\d,.]*(?:\s*[kKmMbB万亿])?"),
    re.compile(r"\b\d+(?:\.\d+)?\s*[xX倍]\b"),
    re.compile(r"\b\d[\d,.]*\s*(?:用户|客户|团队|项目|人|万元|亿元|小时|天|年|stars?)\b", re.IGNORECASE),
)


def verify_candidate_material(
    text: str,
    *,
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    resolved = _require_profile(profile_id, db_path)
    document = _require_document(db_path)
    # 事实门比对整份画像文档：声称的数字、日期、证书必须在用户自己写下的内容里
    # 出现过。这条保护不依赖事实状态机，所以文档模型下依然成立。
    source_text = "\n".join(
        [document.section_text(), *[item["statement"] for item in list_facts(
            profile_id=resolved, status="confirmed", db_path=db_path
        )]]
    ).lower()
    retracted: list[dict[str, Any]] = []
    target = text.strip()
    metrics = {
        match.group(0).lower().replace(" ", "")
        for pattern in _METRIC_PATTERNS
        for match in pattern.finditer(target)
    }
    normalized_source = source_text.replace(" ", "")
    unsupported_metrics = sorted(metric for metric in metrics if metric not in normalized_source)
    date_claims = {
        match.group(0).lower().replace(" ", "")
        for match in re.finditer(r"(?:19|20)\d{2}(?:[年./-]\d{1,2}(?:月|[./-]\d{1,2})?)?", target)
    }
    certificate_claims = {
        " ".join(match.group(0).split()).lower()
        for match in re.finditer(r"[A-Za-z0-9+.#\u4e00-\u9fff -]{2,40}(?:认证|证书)", target)
    }
    unsupported_dates = sorted(claim for claim in date_claims if claim not in normalized_source)
    unsupported_certificates = sorted(
        claim for claim in certificate_claims if claim.replace(" ", "") not in normalized_source
    )
    retracted_hits = [item["statement"] for item in retracted if item["statement"].lower() in target.lower()]
    voice = get_voice_profile(resolved, db_path)
    forbidden = [
        phrase for phrase in (voice or {}).get("banned_phrases", [])
        if phrase and str(phrase).lower() in target.lower()
    ]
    warnings = [
        phrase for phrase in (voice or {}).get("warning_phrases", [])
        if phrase and str(phrase).lower() in target.lower()
    ]
    unsupported_claims = [
        {"type": "metric", "claim": claim} for claim in unsupported_metrics
    ] + [
        {"type": "date", "claim": claim} for claim in unsupported_dates
    ] + [
        {"type": "certificate", "claim": claim} for claim in unsupported_certificates
    ]

    def sentence_for(claim: str) -> str:
        for sentence in re.split(r"(?<=[。！？!?；;\n])", target):
            if claim.replace(" ", "").lower() in sentence.replace(" ", "").lower():
                return sentence.strip()
        return target[:300]

    issues = [
        {
            "severity": "block",
            "type": item["type"],
            "claim": item["claim"],
            "sentence": sentence_for(item["claim"]),
            "message": f"未找到已确认证据支持：{item['claim']}",
        }
        for item in unsupported_claims
    ]
    issues.extend(
        {
            "severity": "block",
            "type": "retracted",
            "claim": claim,
            "sentence": sentence_for(claim),
            "message": f"内容包含已撤回声明：{claim}",
        }
        for claim in retracted_hits
    )
    issues.extend(
        {
            "severity": "block",
            "type": "banned_phrase",
            "claim": str(claim),
            "sentence": sentence_for(str(claim)),
            "message": f"内容包含禁用表达：{claim}",
        }
        for claim in forbidden
    )
    issues.extend(
        {
            "severity": "warning",
            "type": "warning_phrase",
            "claim": str(claim),
            "sentence": sentence_for(str(claim)),
            "message": f"建议复核表达：{claim}",
        }
        for claim in warnings
    )
    verdict = "block" if any(item["severity"] == "block" for item in issues) else "warn" if issues else "pass"
    return {
        "verdict": verdict,
        "can_finalize": verdict != "block",
        "issues": issues,
        "unsupported_metrics": unsupported_metrics,
        "unsupported_dates": unsupported_dates,
        "unsupported_certificates": unsupported_certificates,
        "retracted_claims": retracted_hits,
        "forbidden_phrases": forbidden,
        "warnings": warnings,
        "rule": "只有已确认事实允许进入可信定稿",
    }


def get_or_start_profile_interview(
    conversation_id: int,
    *,
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    resolved = _require_profile(profile_id, db_path)
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM profile_interview_sessions WHERE profile_id = ? AND conversation_id = ?",
            (resolved, conversation_id),
        ).fetchone()
        if row is None:
            cursor = conn.execute(
                """
                INSERT INTO profile_interview_sessions (
                    profile_id, conversation_id, phase, last_question
                ) VALUES (?, ?, 'goals', ?)
                """,
                (resolved, conversation_id, PROFILE_QUESTIONS["goals"]),
            )
            row = conn.execute(
                "SELECT * FROM profile_interview_sessions WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
    result = row_to_dict(row) or {}
    result["question"] = result.get("last_question") or PROFILE_QUESTIONS[result.get("phase", "goals")]
    return result


def get_profile_interview_session(
    conversation_id: int,
    *,
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    resolved = profile_id or active_profile_id(db_path)
    if resolved is None:
        return None
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM profile_interview_sessions WHERE profile_id = ? AND conversation_id = ?",
            (resolved, conversation_id),
        ).fetchone()
    result = row_to_dict(row)
    if result:
        result["question"] = result.get("last_question") or PROFILE_QUESTIONS[result.get("phase", "goals")]
    return result


def set_profile_interview_status(
    conversation_id: int,
    status: Literal["active", "paused", "completed"],
    *,
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    session = get_or_start_profile_interview(
        conversation_id, profile_id=profile_id, db_path=db_path
    )
    with connect(db_path) as conn:
        conn.execute(
            "UPDATE profile_interview_sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, session["id"]),
        )
    return get_profile_interview_session(
        conversation_id, profile_id=int(session["profile_id"]), db_path=db_path
    ) or session


def record_profile_interview_answer(
    conversation_id: int,
    answer: str,
    *,
    profile_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    session = get_or_start_profile_interview(
        conversation_id, profile_id=profile_id, db_path=db_path
    )
    phase = str(session.get("phase") or "experience")
    category = {
        "goals": "career_goal", "experience": "experience", "project": "project",
        "decisions": "responsibility", "metrics": "achievement",
        "hidden_assets": "skill", "narrative": "narrative",
        "stories": "story_seed", "voice": "voice_preference",
    }.get(phase, "experience")
    source = create_candidate_source(
        profile_id=int(session["profile_id"]),
        source_type="chat_message",
        title=f"画像访谈：{phase}",
        content=answer,
        conversation_id=conversation_id,
        db_path=db_path,
    )
    fact = propose_fact(
        profile_id=int(session["profile_id"]),
        category=category,
        statement=answer,
        source_id=int(source["id"]),
        excerpt=answer,
        extraction_method="profile_interview",
        confidence=1.0,
        db_path=db_path,
    )
    if phase == "goals":
        ensure_default_strategy(
            int(session["profile_id"]), target_roles=[answer.strip()[:100]], db_path=db_path
        )
    next_session = advance_profile_interview(
        conversation_id, profile_id=int(session["profile_id"]), db_path=db_path
    )
    return {"proposal": fact, "session": next_session}


def advance_profile_interview(
    conversation_id: int,
    *,
    profile_id: int | None = None,
    coverage_update: dict[str, Any] | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    session = get_or_start_profile_interview(
        conversation_id, profile_id=profile_id, db_path=db_path
    )
    current = session.get("phase", "goals")
    index = PROFILE_INTERVIEW_PHASES.index(current)
    next_phase = PROFILE_INTERVIEW_PHASES[min(index + 1, len(PROFILE_INTERVIEW_PHASES) - 1)]
    coverage = dict(session.get("coverage") or {})
    coverage[current] = True
    coverage.update(coverage_update or {})
    resolved = int(session["profile_id"])
    pending_count = len(list_facts(profile_id=resolved, status="pending", db_path=db_path))
    with connect(db_path) as conn:
        conn.execute(
            """
            UPDATE profile_interview_sessions
            SET phase = ?, status = ?, coverage_json = ?, last_question = ?,
                pending_count = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                next_phase,
                "completed" if next_phase == "complete" else "active",
                json_dump(coverage),
                PROFILE_QUESTIONS[next_phase],
                pending_count,
                session["id"],
            ),
        )
        row = conn.execute(
            "SELECT * FROM profile_interview_sessions WHERE id = ?", (session["id"],)
        ).fetchone()
    result = row_to_dict(row) or {}
    result["question"] = result["last_question"]
    return result


def profile_completeness(
    profile_id: int,
    strategy_id: int | None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    confirmed = list_facts(profile_id=profile_id, status="confirmed", db_path=db_path)
    categories = {item["category"] for item in confirmed}
    checks = {
        "strategy": bool(list_strategies(profile_id, db_path)),
        "experience": "experience" in categories,
        "project": "project" in categories,
        "skills": "skill" in categories,
        "achievements": "achievement" in categories,
        "stories": bool(list_stories(profile_id=profile_id, status="confirmed", strategy_id=strategy_id, db_path=db_path)),
        "voice": get_voice_profile(profile_id, db_path) is not None,
    }
    completed = sum(bool(value) for value in checks.values())
    return {
        "score": round(completed / len(checks) * 100),
        "dimensions": checks,
        "missing": [key for key, value in checks.items() if not value],
    }


def get_career_profile(db_path: str | Path | None = None) -> dict[str, Any]:
    profile_id = active_profile_id(db_path)
    if profile_id is None:
        return {
            "profile": None,
            "strategies": [],
            "active_strategy": None,
            "facts": [],
            "stories": [],
            "sources": [],
            "voice": None,
            "narratives": [],
            "writing_samples": [],
            "pending_changes": [],
            "completeness": {"score": 0, "dimensions": {}, "missing": []},
        }
    document = _require_document(db_path)
    strategies = list_strategies(profile_id, db_path)
    active_strategy = next((item for item in strategies if item.get("is_active")), strategies[0] if strategies else None)
    return {
        "profile": _profile_response(document),
        "strategies": strategies,
        "active_strategy": active_strategy,
        "facts": list_facts(profile_id=profile_id, db_path=db_path),
        "stories": list_stories(profile_id=profile_id, db_path=db_path),
        "sources": list_candidate_sources(profile_id, db_path),
        "voice": get_voice_profile(profile_id, db_path),
        "narratives": list_candidate_narratives(profile_id, db_path),
        "writing_samples": list_writing_samples(profile_id, db_path),
        # 文档模型没有待审队列，保留键是为了不改前端和端点的返回结构。
        "pending_changes": [],
        "document": {
            "path": str(profile_document.document_path(db_path)),
            "markdown": profile_document.render(document),
        },
        "completeness": profile_completeness(
            profile_id, active_strategy.get("id") if active_strategy else None, db_path
        ),
    }


def export_career_profile(db_path: str | Path | None = None) -> dict[str, Any]:
    bundle = get_career_profile(db_path)
    if bundle["profile"] is None:
        raise ValueError("尚未创建候选人画像")
    profile = bundle["profile"]
    export_payload = {
        "schema_version": "bosscopilot-career-profile-v2",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profile": {
            "name": profile.get("name"),
            "locale": profile.get("locale"),
            "knowledge_revision": profile.get("knowledge_revision"),
        },
        "strategies": bundle["strategies"],
        # 文档模型下画像内容不分状态；保留这三个键是为了不改导出格式的消费者。
        "confirmed_facts": bundle["facts"],
        "pending_facts": [],
        "retracted_facts": [],
        "stories": bundle["stories"],
        "voice": bundle.get("voice"),
        "sources": bundle["sources"],
    }
    lines = [
        f"# 候选人资料包：{profile.get('name', '')}",
        "",
        f"- 语言：{profile.get('locale', 'zh-CN')}",
        f"- 知识版本：{profile.get('knowledge_revision', 1)}",
        "",
        "## 职业策略",
    ]
    for strategy in bundle["strategies"]:
        lines.extend(
            [
                f"### {strategy['name']}",
                f"- 目标岗位：{'、'.join(strategy.get('target_roles', [])) or '待补充'}",
                f"- 地点：{'、'.join(strategy.get('locations', [])) or '待补充'}",
                "",
            ]
        )
    lines.append("## 已确认事实")
    grouped: dict[str, list[dict[str, Any]]] = {}
    for fact in export_payload["confirmed_facts"]:
        grouped.setdefault(fact["category"], []).append(fact)
    for category, facts in grouped.items():
        lines.append(f"### {category}")
        lines.extend(f"- {fact['statement']}" for fact in facts)
        lines.append("")
    lines.append("## STAR+R 故事")
    for story in bundle["stories"]:
        if story["status"] != "confirmed":
            continue
        lines.extend(
            [
                f"### {story['title']}",
                f"- S：{story['situation']}",
                f"- T：{story['task']}",
                f"- A：{story['action']}",
                f"- R：{story['result']}",
                f"- Reflection：{story['reflection']}",
                "",
            ]
        )
    return {
        "filename_base": f"career-profile-{profile.get('name', 'candidate')}",
        "json": export_payload,
        "markdown": "\n".join(lines).strip() + "\n",
    }

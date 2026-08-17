from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from ..db import connect, json_dump, row_to_dict
from ..jobs.evaluations import get_latest_completed_job_evaluation
from ..profile.candidate_core import get_candidate_context, verify_candidate_material
from ..profile.intelligence import extract_skills


InterviewType = Literal["general", "hr", "business", "technical", "final"]
InterviewKitStatus = Literal["draft", "ready"]
InterviewRoundStatus = Literal["scheduled", "completed", "cancelled"]
InterviewOutcome = Literal["pending", "passed", "failed"]

INTERVIEW_TYPE_LABELS = {
    "general": "综合面试",
    "hr": "HR 面试",
    "business": "业务面试",
    "technical": "技术面试",
    "final": "终面",
}

_UNALIGNED_LIMITATION = "本准备包按已保存简历和人物画像生成，尚未对照岗位分析。"
_PROFILE_NOISE_RE = re.compile(
    r"(候选人[:：]|姓名[:：]|目标岗位[:：]|求职意向[:：]|求职方向[:：]|求职目标[:：]|"
    r"意向岗位[:：]|期望职位[:：]|期望城市[:：]|期望薪资[:：]|英语[:：]|GitHub|github\.com|"
    r"[\w.+-]+@[\w.-]+\.\w+|电话[:：]|手机[:：]|微信[:：]|https?://|"
    r"CET-?\d|身份证)",
    re.IGNORECASE,
)
_CAREER_INTENT_RE = re.compile(
    r"(求职意向|求职方向|求职目标|目标岗位|意向岗位|期望职位|期望城市|期望薪资|"
    r"期望\s*\d|\d+\s*[kKwW万](?:/月)?)",
    re.IGNORECASE,
)
_FACT_SKIP_CATEGORIES = frozenset({"career_goal", "voice_preference"})
_NAME_ONLY_RE = re.compile(r"^[\u4e00-\u9fff]{2,4}$")
_SKILL_FACT_RE = re.compile(r"^具备\s*(.+?)\s*相关经验$")
_PROJECT_HINT_RE = re.compile(
    r"项目|平台|系统|负责|主导|落地|从.?到|搭建|设计|实现|推进|20\d{2}"
)
_LEGACY_PROMPT_RE = re.compile(r"^请结合真实(?:项目|经历)说明[：:]")
_SKILL_PREFIX_RE = re.compile(r"^(?:具备|熟悉|熟练掌握|掌握|了解)\s*")


def create_interview_kit(
    job_id: int,
    interview_type: InterviewType = "general",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        job_row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if job_row is None:
            raise ValueError("岗位项目不存在")
        profile_row = conn.execute(
            "SELECT * FROM profiles ORDER BY updated_at DESC, id DESC LIMIT 1"
        ).fetchone()
        if profile_row is None:
            raise ValueError("请先保存人物画像和简历")
        version_number = conn.execute(
            "SELECT COUNT(*) AS count FROM interview_kits WHERE job_id = ?",
            (job_id,),
        ).fetchone()["count"] + 1

    job = row_to_dict(job_row) or {}
    profile = row_to_dict(profile_row) or {}
    evaluation = get_latest_completed_job_evaluation(job_id, db_path=db_path)
    aligned_with_job = False
    if evaluation is not None:
        if evaluation["status"] not in {"completed", "partial_failed"}:
            raise ValueError("岗位决策报告尚未完成")
        if evaluation.get("is_stale"):
            raise ValueError("岗位、候选人知识或职业策略已更新，请重新生成岗位评估")
        aligned_with_job = True
    interview_context = _interview_candidate_context(
        profile,
        strategy_id=evaluation.get("strategy_id") if evaluation else None,
        db_path=db_path,
    )
    resume_text = _resume_text_for_kit(profile, interview_context)
    if not resume_text:
        raise ValueError("当前隐私模式下没有可用简历文本")
    if aligned_with_job:
        material_view = _evaluation_material_view(evaluation, interview_context)
    else:
        material_view = _resume_material_view(profile, interview_context)
    content, checklist = _build_kit_content(
        job, material_view, interview_type, aligned_with_job=aligned_with_job
    )
    content["provenance"] = {
        "confirmed_fact_ids": [item["id"] for item in interview_context.get("confirmed_facts", [])],
        "source_ids": sorted({
            evidence["source_id"]
            for item in interview_context.get("confirmed_facts", [])
            for evidence in item.get("evidence", [])
            if evidence.get("source_id")
        }),
        "career_strategy_id": (
            evaluation.get("strategy_id") if evaluation
            else (interview_context.get("strategy") or {}).get("id")
        ),
        "knowledge_revision": evaluation.get("knowledge_revision") if evaluation else None,
        "candidate_context_fingerprint": (
            evaluation.get("context_fingerprint") if evaluation else None
        ),
        "evaluation_id": evaluation.get("id") if evaluation else None,
        "aligned_with_job_analysis": aligned_with_job,
    }
    label = INTERVIEW_TYPE_LABELS[interview_type]
    title_suffix = "" if aligned_with_job else "（按简历准备）"
    title = (
        f"{job.get('company_name') or '目标公司'} · "
        f"{job.get('job_title') or '目标岗位'} · {label}{title_suffix} V{version_number}"
    )
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO interview_kits (
                job_id, profile_id, evaluation_id, interview_type, title, content_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                profile["id"],
                evaluation["id"] if evaluation else None,
                interview_type,
                title[:200],
                json_dump(content),
            ),
        )
        kit_id = cursor.lastrowid
        for index, item in enumerate(checklist, start=1):
            conn.execute(
                """
                INSERT INTO interview_tasks (kit_id, category, title, sort_order)
                VALUES (?, ?, ?, ?)
                """,
                (kit_id, item["category"], item["title"], index),
            )
    add_job_event(
        job_id,
        "interview_kit_created",
        f"创建{label}准备包",
        title,
        db_path=db_path,
    )
    kit = get_interview_kit(kit_id, db_path)
    if kit is None:
        raise RuntimeError("面试准备包创建后无法读取")
    return kit


def list_interview_kits(
    job_id: int | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        if job_id is None:
            rows = conn.execute(
                """
                SELECT * FROM interview_kits
                ORDER BY id DESC
                """
            ).fetchall()
        else:
            if conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone() is None:
                raise ValueError("岗位项目不存在")
            rows = conn.execute(
                """
                SELECT * FROM interview_kits
                WHERE job_id = ?
                ORDER BY id DESC
                """,
                (job_id,),
            ).fetchall()
        return [_kit_response(row, conn, include_content=False) for row in rows]


def get_interview_kit(
    kit_id: int,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM interview_kits WHERE id = ?",
            (kit_id,),
        ).fetchone()
        if row is None:
            return None
        return _kit_response(row, conn, include_content=True)


def update_interview_kit(
    kit_id: int,
    *,
    title: str | None = None,
    status: InterviewKitStatus | None = None,
    self_intro: str | None = None,
    notes: str | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM interview_kits WHERE id = ?",
            (kit_id,),
        ).fetchone()
        if row is None:
            return None
        updates: list[str] = []
        values: list[Any] = []
        if title is not None:
            clean_title = title.strip()
            if not clean_title:
                raise ValueError("准备包名称不能为空")
            updates.append("title = ?")
            values.append(clean_title[:200])
        if status is not None:
            if status == "ready":
                current_content = row_to_dict(row).get("content") or {}
                draft = str(current_content.get("self_intro") or "")
                if draft:
                    gate = verify_candidate_material(draft, db_path=db_path)
                    if not gate["can_finalize"]:
                        raise ValueError("事实安全门未通过，面试准备包不能标记为就绪")
            updates.append("status = ?")
            values.append(status)
        if notes is not None:
            updates.append("notes = ?")
            values.append(notes.strip()[:10_000])
        if self_intro is not None:
            content = row_to_dict(row).get("content") or {}
            content["self_intro"] = self_intro.strip()[:10_000]
            content["self_intro_user_edited"] = True
            updates.append("content_json = ?")
            values.append(json_dump(content))
            if status is None:
                updates.append("status = 'draft'")
        if updates:
            conn.execute(
                f"""
                UPDATE interview_kits
                SET {", ".join(updates)}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (*values, kit_id),
            )
    return get_interview_kit(kit_id, db_path)


def delete_interview_kit(
    kit_id: int,
    db_path: str | Path | None = None,
) -> bool:
    with connect(db_path) as conn:
        cursor = conn.execute("DELETE FROM interview_kits WHERE id = ?", (kit_id,))
    return cursor.rowcount > 0


def update_interview_task(
    kit_id: int,
    task_id: int,
    completed: bool,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        task = conn.execute(
            """
            SELECT id FROM interview_tasks
            WHERE id = ? AND kit_id = ?
            """,
            (task_id, kit_id),
        ).fetchone()
        if task is None:
            raise ValueError("面试准备任务不存在")
        conn.execute(
            """
            UPDATE interview_tasks
            SET completed = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (int(completed), task_id),
        )
        conn.execute(
            """
            UPDATE interview_kits
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (kit_id,),
        )
    kit = get_interview_kit(kit_id, db_path)
    if kit is None:
        raise ValueError("面试准备包不存在")
    return kit


def list_interview_rounds(
    job_id: int,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        if conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone() is None:
            raise ValueError("岗位项目不存在")
        rows = conn.execute(
            """
            SELECT * FROM interview_rounds
            WHERE job_id = ?
            ORDER BY
                CASE WHEN scheduled_at IS NULL OR scheduled_at = '' THEN 1 ELSE 0 END,
                scheduled_at ASC,
                id ASC
            """,
            (job_id,),
        ).fetchall()
    return [row_to_dict(row) for row in rows]


def create_interview_round(
    job_id: int,
    *,
    kit_id: int | None = None,
    round_type: InterviewType = "general",
    scheduled_at: str | None = None,
    interviewer: str = "",
    location: str = "",
    notes: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    clean_scheduled_at = _clean_datetime(scheduled_at)
    with connect(db_path) as conn:
        job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if job is None:
            raise ValueError("岗位项目不存在")
        if kit_id is not None:
            kit = conn.execute(
                "SELECT id FROM interview_kits WHERE id = ? AND job_id = ?",
                (kit_id, job_id),
            ).fetchone()
            if kit is None:
                raise ValueError("面试准备包不存在或不属于当前岗位")
        cursor = conn.execute(
            """
            INSERT INTO interview_rounds (
                job_id, kit_id, round_type, scheduled_at, interviewer,
                location, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                kit_id,
                round_type,
                clean_scheduled_at,
                interviewer.strip()[:200],
                location.strip()[:300],
                notes.strip()[:5_000],
            ),
        )
        round_id = cursor.lastrowid
    label = INTERVIEW_TYPE_LABELS[round_type]
    detail = " · ".join(
        item
        for item in (
            clean_scheduled_at or "时间待定",
            interviewer.strip(),
            location.strip(),
        )
        if item
    )
    add_job_event(
        job_id,
        "interview_scheduled",
        f"安排{label}",
        detail,
        occurred_at=clean_scheduled_at,
        db_path=db_path,
    )
    result = get_interview_round(round_id, db_path)
    if result is None:
        raise RuntimeError("面试轮次创建后无法读取")
    return result


def get_interview_round(
    round_id: int,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM interview_rounds WHERE id = ?",
            (round_id,),
        ).fetchone()
    return row_to_dict(row)


def update_interview_round(
    round_id: int,
    *,
    scheduled_at: str | None = None,
    interviewer: str | None = None,
    location: str | None = None,
    status: InterviewRoundStatus | None = None,
    outcome: InterviewOutcome | None = None,
    notes: str | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    updates: list[str] = []
    values: list[Any] = []
    if scheduled_at is not None:
        updates.append("scheduled_at = ?")
        values.append(_clean_datetime(scheduled_at))
    for field, value, limit in (
        ("interviewer", interviewer, 200),
        ("location", location, 300),
        ("notes", notes, 5_000),
    ):
        if value is not None:
            updates.append(f"{field} = ?")
            values.append(value.strip()[:limit])
    if status is not None:
        updates.append("status = ?")
        values.append(status)
    if outcome is not None:
        updates.append("outcome = ?")
        values.append(outcome)
    with connect(db_path) as conn:
        existing = conn.execute(
            "SELECT * FROM interview_rounds WHERE id = ?",
            (round_id,),
        ).fetchone()
        if existing is None:
            return None
        if updates:
            conn.execute(
                f"""
                UPDATE interview_rounds
                SET {", ".join(updates)}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (*values, round_id),
            )
        job_id = existing["job_id"]
    if status == "completed" or outcome in {"passed", "failed"}:
        result_label = (
            "通过" if outcome == "passed"
            else "未通过" if outcome == "failed"
            else "已完成"
        )
        add_job_event(
            job_id,
            "interview_result",
            f"{INTERVIEW_TYPE_LABELS.get(existing['round_type'], '面试')}：{result_label}",
            notes or "",
            db_path=db_path,
        )
    return get_interview_round(round_id, db_path)


def delete_interview_round(
    round_id: int,
    db_path: str | Path | None = None,
) -> bool:
    with connect(db_path) as conn:
        cursor = conn.execute("DELETE FROM interview_rounds WHERE id = ?", (round_id,))
    return cursor.rowcount > 0


def list_job_events(
    job_id: int,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        if conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone() is None:
            raise ValueError("岗位项目不存在")
        rows = conn.execute(
            """
            SELECT * FROM job_events
            WHERE job_id = ?
            ORDER BY occurred_at DESC, id DESC
            """,
            (job_id,),
        ).fetchall()
    return [row_to_dict(row) for row in rows]


def add_job_event(
    job_id: int,
    event_type: str,
    title: str,
    detail: str = "",
    *,
    occurred_at: str | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    clean_title = title.strip()
    if not clean_title:
        raise ValueError("时间线标题不能为空")
    clean_occurred_at = _clean_datetime(occurred_at) if occurred_at else None
    with connect(db_path) as conn:
        if conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone() is None:
            raise ValueError("岗位项目不存在")
        cursor = conn.execute(
            """
            INSERT INTO job_events (
                job_id, event_type, title, detail, occurred_at
            ) VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
            """,
            (
                job_id,
                event_type.strip()[:50] or "note",
                clean_title[:200],
                detail.strip()[:5_000],
                clean_occurred_at,
            ),
        )
        event_id = cursor.lastrowid
        row = conn.execute(
            "SELECT * FROM job_events WHERE id = ?",
            (event_id,),
        ).fetchone()
    return row_to_dict(row)


def _kit_response(row, conn, *, include_content: bool) -> dict[str, Any]:
    kit = row_to_dict(row) or {}
    tasks = conn.execute(
        """
        SELECT * FROM interview_tasks
        WHERE kit_id = ?
        ORDER BY sort_order, id
        """,
        (kit["id"],),
    ).fetchall()
    task_items = [row_to_dict(item) for item in tasks]
    kit["task_count"] = len(task_items)
    kit["completed_task_count"] = sum(bool(item["completed"]) for item in task_items)
    if include_content:
        kit["tasks"] = task_items
        content = kit.get("content")
        if isinstance(content, dict):
            kit["content"] = _present_kit_content(content)
    else:
        kit.pop("content", None)
        kit.pop("notes", None)
    return kit


def _interview_candidate_context(
    profile: dict[str, Any],
    *,
    strategy_id: int | None,
    db_path: str | Path | None,
) -> dict[str, Any]:
    try:
        return get_candidate_context(
            "interview",
            profile_id=int(profile["id"]),
            strategy_id=strategy_id,
            db_path=db_path,
        )
    except ValueError:
        return {"confirmed_facts": [], "strategy": None}


def _resume_text_for_kit(profile: dict[str, Any], context: dict[str, Any]) -> str:
    from_facts = "\n".join(
        str(item.get("statement") or "").strip()
        for item in context.get("confirmed_facts") or []
        if str(item.get("statement") or "").strip()
    )
    if from_facts.strip():
        return from_facts.strip()
    return str(profile.get("resume_redacted_text") or profile.get("resume_text") or "").strip()


def _resume_evidence_lines(resume_text: str) -> list[str]:
    lines: list[str] = []
    seen: set[str] = set()
    for raw in resume_text.splitlines():
        line = raw.strip().strip("-•*·# ")
        if len(line) < 8 or _is_resume_header_noise(line):
            continue
        key = line.casefold()
        if key in seen:
            continue
        seen.add(key)
        lines.append(line[:180])
    return lines


def _is_profile_noise(text: str) -> bool:
    compact = " ".join(text.split())
    if not compact:
        return True
    if _looks_like_career_intent(compact):
        return True
    if _PROFILE_NOISE_RE.search(compact) and not _PROJECT_HINT_RE.search(compact):
        return True
    if compact.count("｜") + compact.count("|") >= 2 and _PROFILE_NOISE_RE.search(compact):
        return True
    return False


def _looks_like_career_intent(text: str) -> bool:
    compact = " ".join(text.split())
    if _CAREER_INTENT_RE.search(compact) and not _PROJECT_HINT_RE.search(compact):
        return True
    parts = [part.strip() for part in re.split(r"[，,、]", compact) if part.strip()]
    if 2 <= len(parts) <= 4 and len(compact) <= 40 and not _PROJECT_HINT_RE.search(compact):
        has_city = any(
            re.search(r"上海|北京|深圳|杭州|广州|成都|南京|武汉|苏州|西安|远程", part)
            for part in parts
        )
        has_role = any(re.search(r"经理|工程师|设计师|产品|运营|顾问", part) for part in parts)
        if has_city and has_role:
            return True
    return False


def _is_resume_header_noise(text: str) -> bool:
    compact = " ".join(text.split())
    return _is_profile_noise(compact) or bool(_NAME_ONLY_RE.match(compact))


def _looks_like_skill(text: str) -> bool:
    compact = text.strip()
    if _SKILL_FACT_RE.match(compact):
        return True
    if _SKILL_PREFIX_RE.match(compact) and len(compact) <= 80:
        return True
    separators = compact.count("、") + compact.count(",") + compact.count("/")
    return separators >= 2 and len(compact) <= 120 and not _PROJECT_HINT_RE.search(compact)


def _looks_like_project(text: str) -> bool:
    if _looks_like_skill(text) or _is_profile_noise(text):
        return False
    return bool(_PROJECT_HINT_RE.search(text)) or len(text) >= 24


def _skill_label(text: str) -> str:
    matched = _SKILL_FACT_RE.match(text.strip())
    if matched:
        return matched.group(1).strip()
    return _SKILL_PREFIX_RE.sub("", text.strip()).strip(" 。；;")


def _short_title(text: str, limit: int = 22) -> str:
    chunk = re.split(r"[｜|。；;\n]", text.strip(), maxsplit=1)[0].strip()
    chunk = re.sub(r"^20\d{2}[.\-/年].{0,12}", "", chunk).strip(" ｜|-")
    if not chunk:
        chunk = text.strip()
    return chunk[:limit] + ("…" if len(chunk) > limit else "")


def _classify_requirement(text: str, status: str) -> str:
    if status == "no_evidence":
        return "gap"
    if _looks_like_skill(text):
        return "skill"
    if _looks_like_project(text):
        return "project"
    return "project" if len(text) >= 16 else "skill"


def _evaluation_material_view(
    evaluation: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    facts = {int(item["id"]): item for item in context.get("confirmed_facts", [])}
    requirements = []
    for item in evaluation.get("effective_requirements", []):
        evidence = [
            {"excerpt": facts[fact_id]["statement"], "matched_skills": [], "matched_terms": []}
            for fact_id in [int(value) for value in item.get("effective_fact_ids") or []]
            if fact_id in facts
        ]
        requirements.append({
            "id": item["requirement_key"], "text": item["text"],
            "importance": item["importance"],
            "status": item.get("effective_match_status", item["match_status"]),
            "evidence": evidence,
        })
    return {"requirements": requirements, "feedback": {}}


def _resume_material_view(
    profile: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    requirements: list[dict[str, Any]] = []
    for item in context.get("confirmed_facts") or []:
        statement = str(item.get("statement") or "").strip()
        if (
            not statement
            or item.get("category") in _FACT_SKIP_CATEGORIES
            or _is_resume_header_noise(statement)
        ):
            continue
        excerpts = [
            str(evidence.get("excerpt") or "").strip()
            for evidence in item.get("evidence") or []
            if str(evidence.get("excerpt") or "").strip()
        ]
        if not excerpts:
            excerpts = [statement]
        requirements.append({
            "id": f"fact-{item.get('id')}",
            "text": statement,
            "importance": "core" if _looks_like_project(statement) else "supporting",
            "status": "matched",
            "evidence": [
                {"excerpt": excerpt, "matched_skills": [], "matched_terms": []}
                for excerpt in excerpts
            ],
        })
    if requirements:
        return {"requirements": requirements, "feedback": {}}

    resume_text = _resume_text_for_kit(profile, context)
    for index, line in enumerate(_resume_evidence_lines(resume_text)[:8]):
        requirements.append({
            "id": f"line-{index}",
            "text": line,
            "importance": "core" if _looks_like_project(line) else "supporting",
            "status": "matched",
            "evidence": [{
                "excerpt": line,
                "matched_skills": [],
                "matched_terms": [],
            }],
        })
    if not requirements:
        for index, skill in enumerate(extract_skills(resume_text)[:6]):
            requirements.append({
                "id": f"skill-{index}",
                "text": skill,
                "importance": "supporting",
                "status": "matched",
                "evidence": [{
                    "excerpt": skill,
                    "matched_skills": [skill],
                    "matched_terms": [skill],
                }],
            })
    return {"requirements": requirements, "feedback": {}}


def _build_kit_content(
    job: dict[str, Any],
    analysis: dict[str, Any],
    interview_type: InterviewType,
    *,
    aligned_with_job: bool = True,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    feedback = analysis.get("feedback") or {}
    requirements = []
    evidence: list[dict[str, str]] = []
    strengths: list[str] = []
    gaps: list[str] = []
    matched_terms: list[str] = []
    matched_keys: set[str] = set()

    for requirement in analysis.get("requirements", []):
        effective_status = (
            feedback.get(requirement["id"], {}).get("status")
            or requirement.get("status")
        )
        item_evidence = []
        for item in requirement.get("evidence", []):
            excerpt = str(item.get("excerpt") or "").strip()
            if not excerpt:
                continue
            item_evidence.append(excerpt)
            evidence.append(
                {
                    "requirement_id": requirement["id"],
                    "requirement": requirement["text"],
                    "excerpt": excerpt,
                }
            )
            for term in [
                *item.get("matched_skills", []),
                *item.get("matched_terms", []),
            ]:
                clean = str(term).strip()
                key = clean.casefold()
                if clean and key not in matched_keys:
                    matched_terms.append(clean)
                    matched_keys.add(key)
        requirements.append(
            {
                "id": requirement["id"],
                "text": requirement["text"],
                "importance": requirement["importance"],
                "status": effective_status,
                "evidence": item_evidence,
            }
        )
        if effective_status == "matched":
            strengths.append(requirement["text"])
        elif effective_status in {"partial", "no_evidence"}:
            gaps.append(requirement["text"])

    job_title = str(job.get("job_title") or "目标岗位")
    company = str(job.get("company_name") or "目标公司")
    strength_phrase = "、".join(matched_terms[:6]) or "当前简历中的相关经历"
    if aligned_with_job:
        self_intro = (
            f"我正在应聘 {company} 的{job_title}。"
            f"结合当前简历，我能够直接举证的相关能力包括{strength_phrase}。"
            "面试时我会围绕下方证据说明具体背景、行动和结果；"
            "尚未写入简历或缺少证据的部分会如实说明，不做推测。"
        )
    else:
        target = (
            f"{company} 的{job_title}"
            if company != "目标公司" or job_title != "目标岗位"
            else "下一场面试"
        )
        self_intro = (
            f"我正在按已保存简历准备{target}。"
            f"目前能够直接举证的相关经历包括{strength_phrase}。"
            "以下问题尚未对照岗位分析；面试时只讲可验证事实，不做推测。"
        )
    questions = _build_interview_questions(
        requirements,
        interview_type=interview_type,
        aligned_with_job=aligned_with_job,
    )

    star_stories = [
        {
            "id": f"star-{index}",
            "title": item["requirement"],
            "source_excerpt": item["excerpt"],
            "situation": "请补充当时的业务背景、团队和限制条件。",
            "task": "请补充你本人负责的目标与范围。",
            "action": "请补充你亲自采取的关键行动。",
            "result": "请补充可验证结果；没有量化数据时不要编造。",
        }
        for index, item in enumerate(evidence[:6], start=1)
    ]
    reverse_questions = [
        f"这个{job_title}入职前三个月最重要的成功标准是什么？",
        "当前团队最希望新成员优先解决的业务或协作问题是什么？",
        "这轮面试后续还有哪些环节，您建议我重点补充哪些信息？",
    ]
    if gaps:
        reverse_questions.append(
            f"关于“{gaps[0]}”，团队实际使用场景和能力要求是什么？"
        )
    checklist = [
        {"category": "logistics", "title": "确认面试时间、形式、地点和参会人"},
        {"category": "story", "title": "把自我介绍练习到 60-90 秒并保持自然"},
        {"category": "evidence", "title": "为每项核心要求准备真实项目证据"},
        {"category": "questions", "title": "选择至少 3 个反向提问"},
        {"category": "follow_up", "title": "准备面试后复盘与感谢信息"},
    ]
    for gap in gaps[:3]:
        checklist.append(
            {"category": "gap", "title": f"准备如实回应证据缺口：{gap[:120]}"}
        )
    content = {
        "method": "local_interview_evidence_v1",
        "interview_type": interview_type,
        "positioning": {
            "headline": f"{job_title}候选人",
            "verified_strengths": strengths[:8],
            "evidence_gaps": gaps[:8],
        },
        "self_intro": self_intro,
        "self_intro_user_edited": False,
        "questions": questions,
        "star_stories": star_stories,
        "reverse_questions": reverse_questions,
        "limitations": [
            *([_UNALIGNED_LIMITATION] if not aligned_with_job else []),
            "所有候选人事实只来自当前脱敏简历证据",
            "STAR 结构中的背景、任务、行动和结果需要用户亲自补充",
            "面试问题是准备建议，不代表面试官一定会提问",
        ],
    }
    return content, checklist


def _build_interview_questions(
    requirements: list[dict[str, Any]],
    *,
    interview_type: InterviewType,
    aligned_with_job: bool,
) -> list[dict[str, Any]]:
    usable = [item for item in requirements if not _is_profile_noise(item["text"])]
    projects = [item for item in usable if _classify_requirement(item["text"], item["status"]) == "project"]
    skills = [item for item in usable if _classify_requirement(item["text"], item["status"]) == "skill"]
    gaps = [item for item in usable if item["status"] in {"partial", "no_evidence"}]
    questions: list[dict[str, Any]] = []

    def add(question: dict[str, Any]) -> None:
        question["id"] = f"question-{len(questions) + 1}"
        questions.append(question)

    add(_intro_question(aligned_with_job, interview_type))
    if interview_type in {"hr", "final", "general"}:
        add(_motivation_question(aligned_with_job))

    for item in projects[:4]:
        add(_project_question(item, aligned_with_job))
    if not projects:
        add(_fallback_project_question(aligned_with_job))

    skill_labels = []
    skill_evidence: list[str] = []
    for item in skills:
        label = _skill_label(item["text"])
        if label and label.casefold() not in {value.casefold() for value in skill_labels}:
            skill_labels.append(label)
        skill_evidence.extend(item["evidence"])
    if skill_labels:
        add(_skill_cluster_question(skill_labels, skill_evidence, aligned_with_job))

    for item in gaps[:2]:
        if item in projects[:4]:
            continue
        add(_gap_question(item, aligned_with_job))

    if interview_type in {"hr", "final"}:
        add(_behavioral_question(aligned_with_job))
    return questions[:10]


def _question_payload(
    *,
    question: str,
    reason: str,
    direction: str,
    evidence: list[str],
    status: str,
    category: str,
) -> dict[str, Any]:
    return {
        "question": question,
        "reason": reason,
        "answer_direction": direction,
        "evidence": [item for item in evidence if item][:6],
        "status": status,
        "category": category,
    }


def _intro_question(aligned: bool, interview_type: InterviewType) -> dict[str, Any]:
    if interview_type == "hr":
        question = "请用一分钟介绍你自己，并说明你现在最想做的方向。"
    else:
        question = "请用一分钟介绍你自己，并点出一段最能被验证的经历。"
    return _question_payload(
        question=question,
        reason="开场题，用来组织方向和可验证经历。" if aligned else "开场题，按已保存简历组织，尚未对照岗位分析。",
        direction="先用一句话说清方向，再举一段有结果的经历，最后点出简历里能对上的证据。",
        evidence=[],
        status="partial",
        category="intro",
    )


def _motivation_question(aligned: bool) -> dict[str, Any]:
    return _question_payload(
        question="为什么考虑这个方向，最近一段经历里哪一点最能说明你适合？",
        reason="确认动机是否和简历经历对得上。" if aligned else "练习动机表达，尚未对照具体岗位。",
        direction="用一段真实经历说明选择，不要只讲兴趣；没有证据的部分如实说边界。",
        evidence=[],
        status="partial",
        category="intro",
    )


def _project_question(item: dict[str, Any], aligned: bool) -> dict[str, Any]:
    title = _short_title(item["text"])
    return _question_payload(
        question=f"讲一下你在「{title}」里具体负责什么，结果怎么验证？",
        reason="用简历里的项目练 STAR。" if not aligned else "对应岗位相关经历，用项目讲清贡献和结果。",
        direction="只讲自己亲自做的部分：背景、目标、行动、结果；能量化就量化，不能量化就说清变化。",
        evidence=item["evidence"],
        status=item["status"],
        category="project",
    )


def _fallback_project_question(aligned: bool) -> dict[str, Any]:
    return _question_payload(
        question="讲一个你最近完整负责过的项目，包括背景、行动和结果。",
        reason="用简历里的项目练 STAR。" if not aligned else "岗位面通常会从完整项目开始追问。",
        direction="只讲自己亲自做的部分；结果能量化就量化，不能量化就说清变化。",
        evidence=[],
        status="partial",
        category="project",
    )


def _skill_cluster_question(
    labels: list[str],
    evidence: list[str],
    aligned: bool,
) -> dict[str, Any]:
    shown = "、".join(labels[:6])
    return _question_payload(
        question=f"简历里写到{shown}。请选一个你用得最深的，讲清场景、做法和边界。",
        reason="把分散技能收成一道追问，避免逐条背词。" if not aligned else "对照岗位技能要求，深挖一项而不是报清单。",
        direction="选一项讲清楚：用在哪个场景、你怎么做、效果是什么、不会什么。不要把技能名念一遍。",
        evidence=evidence,
        status="matched",
        category="skill",
    )


def _gap_question(item: dict[str, Any], aligned: bool) -> dict[str, Any]:
    title = _short_title(item["text"], 28)
    return _question_payload(
        question=f"如果被问到「{title}」，简历证据不够时你会怎么如实回答？",
        reason="练习证据缺口的诚实答法，避免临场编造。" if not aligned else "岗位有要求但简历证据不足，先准备如实回应。",
        direction="先承认边界，再补相邻经验和学习路径，不要声称未验证经历。",
        evidence=item["evidence"],
        status=item["status"] if item["status"] in {"partial", "no_evidence"} else "partial",
        category="gap",
    )


def _behavioral_question(aligned: bool) -> dict[str, Any]:
    return _question_payload(
        question="讲一次你和同事判断不一致，最后怎么推进的。",
        reason="HR / 终面常见协作题。" if aligned else "练习协作表达，尚未对照具体岗位。",
        direction="说清分歧、你的判断、沟通方式和结果；不要贬低他人。",
        evidence=[],
        status="partial",
        category="behavioral",
    )


def _present_kit_content(content: dict[str, Any]) -> dict[str, Any]:
    raw_questions = list(content.get("questions") or [])
    aligned = bool((content.get("provenance") or {}).get("aligned_with_job_analysis"))
    polished: list[dict[str, Any]] = []
    skill_labels: list[str] = []
    skill_evidence: list[str] = []
    first_skill_id: str | None = None
    for question in raw_questions:
        text = str(question.get("question") or "").strip()
        if not text:
            continue
        legacy = _LEGACY_PROMPT_RE.match(text)
        payload = text[legacy.end():].strip() if legacy else ""
        if _is_profile_noise(payload or text):
            continue
        if legacy and _looks_like_skill(payload):
            label = _skill_label(payload)
            if label and label.casefold() not in {value.casefold() for value in skill_labels}:
                skill_labels.append(label)
            skill_evidence.extend(str(item) for item in (question.get("evidence") or []) if item)
            if first_skill_id is None:
                first_skill_id = str(question.get("id") or "") or None
            continue
        item = _polish_question(question)
        if item is None:
            continue
        if item.get("category") == "skill":
            if first_skill_id is None:
                first_skill_id = str(item.get("id") or "") or None
            for label in _labels_from_skill_question(item["question"]):
                if label.casefold() not in {value.casefold() for value in skill_labels}:
                    skill_labels.append(label)
            skill_evidence.extend(str(excerpt) for excerpt in (item.get("evidence") or []) if excerpt)
            continue
        polished.append(item)
    if skill_labels:
        clustered = _skill_cluster_question(skill_labels, skill_evidence, aligned)
        clustered["id"] = first_skill_id or f"question-{len(polished) + 1}"
        insert_at = next(
            (index for index, item in enumerate(polished) if item.get("category") in {"gap", "behavioral"}),
            len(polished),
        )
        polished.insert(insert_at, clustered)
    if not polished:
        polished = _build_interview_questions([], interview_type="general", aligned_with_job=False)
    presented = dict(content)
    presented["questions"] = polished
    return presented


def _labels_from_skill_question(question: str) -> list[str]:
    matched = re.search(r"简历里写到(.+?)[。．.]", question)
    chunk = matched.group(1) if matched else question
    return [part.strip() for part in re.split(r"[、,/，]", chunk) if part.strip()][:6]


def _polish_question(question: dict[str, Any]) -> dict[str, Any] | None:
    text = str(question.get("question") or "").strip()
    if not text:
        return None
    payload = text
    legacy = _LEGACY_PROMPT_RE.match(text)
    if legacy:
        payload = text[legacy.end():].strip()
        if _is_profile_noise(payload):
            return None
        status = str(question.get("status") or "partial")
        rebuilt = _project_question(
            {
                "text": payload,
                "evidence": list(question.get("evidence") or []),
                "status": status,
            },
            aligned=False,
        ) if _looks_like_project(payload) else (
            _skill_cluster_question(
                [_skill_label(payload)],
                list(question.get("evidence") or []),
                aligned=False,
            ) if _looks_like_skill(payload) else None
        )
        if rebuilt is None:
            return None
        rebuilt["id"] = question.get("id") or rebuilt.get("id")
        return rebuilt
    presented = dict(question)
    presented.setdefault("category", _infer_category(text, str(question.get("status") or "")))
    return presented


def _infer_category(question: str, status: str) -> str:
    if status == "no_evidence" or "暂无证据" in question or "如实" in question and "不够" in question:
        return "gap"
    if any(marker in question for marker in ("介绍你自己", "为什么考虑", "一分钟")):
        return "intro"
    if any(marker in question for marker in ("同事", "冲突", "协作", "推进")):
        return "behavioral"
    if any(marker in question for marker in ("技能", "写到", "用得最深")):
        return "skill"
    return "project"


def _clean_datetime(value: str | None) -> str | None:
    if value is None:
        return None
    clean = value.strip()
    if not clean:
        return None
    try:
        parsed = datetime.fromisoformat(clean.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("时间必须是有效的 ISO 日期时间") from exc
    return parsed.isoformat(timespec="minutes")

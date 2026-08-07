from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from .db import connect, json_dump, row_to_dict
from .job_evaluations import get_latest_completed_job_evaluation
from .candidate_core import get_candidate_context, verify_candidate_material


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
    if evaluation is None:
        raise ValueError("请先生成岗位决策与证据报告")
    if evaluation["status"] not in {"completed", "partial_failed"}:
        raise ValueError("岗位决策报告尚未完成")
    if evaluation.get("is_stale"):
        raise ValueError("岗位、候选人知识或职业策略已更新，请重新生成岗位评估")
    interview_context = get_candidate_context(
        "interview", profile_id=int(profile["id"]),
        strategy_id=evaluation.get("strategy_id"), db_path=db_path,
    )
    resume_text = "\n".join(item["statement"] for item in interview_context["confirmed_facts"])
    if not resume_text.strip():
        raise ValueError("当前隐私模式下没有可用简历文本")
    material_view = _evaluation_material_view(evaluation, interview_context)
    content, checklist = _build_kit_content(job, material_view, interview_type)
    content["provenance"] = {
        "confirmed_fact_ids": [item["id"] for item in interview_context.get("confirmed_facts", [])],
        "source_ids": sorted({evidence["source_id"] for item in interview_context.get("confirmed_facts", []) for evidence in item.get("evidence", [])}),
        "career_strategy_id": evaluation.get("strategy_id"),
        "knowledge_revision": evaluation.get("knowledge_revision"),
        "candidate_context_fingerprint": evaluation.get("context_fingerprint"),
        "evaluation_id": evaluation.get("id"),
    }
    label = INTERVIEW_TYPE_LABELS[interview_type]
    title = (
        f"{job.get('company_name') or '目标公司'} · "
        f"{job.get('job_title') or '目标岗位'} · {label} V{version_number}"
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
                evaluation["id"],
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
    job_id: int,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
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
        if job["status"] in {"saved", "applied"}:
            conn.execute(
                """
                UPDATE jobs
                SET status = 'interviewing', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (job_id,),
            )
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
    else:
        kit.pop("content", None)
        kit.pop("notes", None)
    return kit


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


def _build_kit_content(
    job: dict[str, Any],
    analysis: dict[str, Any],
    interview_type: InterviewType,
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
    self_intro = (
        f"我正在应聘 {company} 的{job_title}。"
        f"结合当前简历，我能够直接举证的相关能力包括{strength_phrase}。"
        "面试时我会围绕下方证据说明具体背景、行动和结果；"
        "尚未写入简历或缺少证据的部分会如实说明，不做推测。"
    )
    questions = []
    for index, requirement in enumerate(requirements[:12], start=1):
        if requirement["status"] == "matched":
            question = f"请结合真实项目说明你如何满足：{requirement['text']}"
            direction = "先交代背景与目标，再说明你的具体行动、结果和复盘。"
        elif requirement["status"] == "partial":
            question = f"你对“{requirement['text']}”有哪些相关经验，边界在哪里？"
            direction = "先说明已经做过的部分，再明确未覆盖部分和可迁移能力。"
        else:
            question = f"岗位要求“{requirement['text']}”，但简历暂无证据，你会如何回应？"
            direction = "不要声称具备未验证经验；说明真实相邻经历、学习路径和确认边界。"
        questions.append(
            {
                "id": f"question-{index}",
                "question": question,
                "reason": "该问题直接对应岗位要求和当前证据覆盖情况。",
                "answer_direction": direction,
                "evidence": requirement["evidence"],
                "status": requirement["status"],
            }
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
            "所有候选人事实只来自当前脱敏简历证据",
            "STAR 结构中的背景、任务、行动和结果需要用户亲自补充",
            "面试问题是准备建议，不代表面试官一定会提问",
        ],
    }
    return content, checklist


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

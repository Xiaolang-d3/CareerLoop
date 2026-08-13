from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .candidate_core import (
    ProfileNotInitializedError,
    active_profile_id,
    create_candidate_source,
    create_story,
    propose_fact,
)
from .db import connect, json_dump, row_to_dict, rows_to_dicts


APPLICATION_STAGES = {
    "saved",
    "shortlisted",
    "applied",
    "recruiter_screen",
    "interview",
    "final",
    "offer",
    "hired",
    "rejected",
    "withdrawn",
    "no_response",
    "archived",
}

PROGRESSED_STAGES = {
    "applied",
    "recruiter_screen",
    "interview",
    "final",
    "offer",
    "hired",
    "rejected",
    "withdrawn",
    "no_response",
}

POSITIVE_STAGES = {"recruiter_screen", "interview", "final", "offer", "hired"}


def record_application_stage(
    job_id: int,
    *,
    to_stage: str,
    strategy_id: int | None = None,
    note: str = "",
    feedback_verbatim: str = "",
    source: str = "user",
    occurred_at: str | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if to_stage not in APPLICATION_STAGES:
        raise ValueError("求职阶段不合法")
    with connect(db_path) as conn:
        job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if job is None:
            raise ValueError("岗位项目不存在")
        latest = conn.execute(
            """
            SELECT to_stage FROM application_stage_events
            WHERE job_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1
            """,
            (job_id,),
        ).fetchone()
        from_stage = latest["to_stage"] if latest else "saved"
        if (
            from_stage == to_stage
            and not note.strip()
            and not feedback_verbatim.strip()
        ):
            existing = conn.execute(
                """
                SELECT * FROM application_stage_events
                WHERE job_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1
                """,
                (job_id,),
            ).fetchone()
            return row_to_dict(existing) or {}
        cursor = conn.execute(
            """
            INSERT INTO application_stage_events (
                job_id, strategy_id, from_stage, to_stage, source, note,
                feedback_verbatim, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
            """,
            (
                job_id,
                strategy_id or job["career_strategy_id"],
                from_stage,
                to_stage,
                source[:40],
                note.strip()[:5000],
                feedback_verbatim.strip()[:10000],
                occurred_at,
            ),
        )
        coarse = {
            "saved": "saved",
            "shortlisted": "saved",
            "applied": "applied",
            "recruiter_screen": "interviewing",
            "interview": "interviewing",
            "final": "interviewing",
            "offer": "offer",
            "hired": "offer",
            "rejected": "rejected",
            "withdrawn": "archived",
            "no_response": "archived",
            "archived": "archived",
        }[to_stage]
        conn.execute(
            "UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (coarse, job_id),
        )
        row = conn.execute(
            "SELECT * FROM application_stage_events WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return row_to_dict(row) or {}


def record_interview_debrief(
    job_id: int,
    *,
    round_id: int | None = None,
    input_source: str = "recall",
    summary: str = "",
    questions: list[dict[str, Any]] | None = None,
    strengths: list[str] | None = None,
    gaps: list[str] | None = None,
    feedback_verbatim: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    profile_id = active_profile_id(db_path)
    if profile_id is None:
        raise ProfileNotInitializedError("请先创建候选人画像")
    with connect(db_path) as conn:
        if conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone() is None:
            raise ValueError("岗位项目不存在")
    questions = questions or []
    source_text = "\n\n".join(
        [summary.strip(), feedback_verbatim.strip()]
        + [
            f"Q: {item.get('question', '')}\nA: {item.get('answer', '')}"
            for item in questions
        ]
    ).strip()
    source = create_candidate_source(
        profile_id=profile_id,
        source_type="interview_debrief",
        title=f"岗位 {job_id} 面试复盘",
        content=source_text or "面试复盘（未提供文字内容）",
        metadata={"job_id": job_id, "round_id": round_id, "input_source": input_source},
        db_path=db_path,
    )
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO interview_debriefs (
                job_id, round_id, source_id, input_source, summary, questions_json,
                strengths_json, gaps_json, feedback_verbatim
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                round_id,
                # Candidate sources are now represented by the profile document
                # and memory evidence records rather than the retired
                # candidate_sources table. Keep the debrief row independent of
                # that legacy foreign key until source links are migrated.
                None,
                input_source[:20],
                summary.strip()[:10000],
                json_dump(questions),
                json_dump(strengths or []),
                json_dump(gaps or []),
                feedback_verbatim.strip()[:10000],
            ),
        )
        debrief_id = int(cursor.lastrowid)
        strategy_row = conn.execute(
            "SELECT career_strategy_id FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        strategy_id = strategy_row["career_strategy_id"] if strategy_row else None
        for item in questions:
            question = str(item.get("question") or "").strip()
            if not question:
                continue
            competency = str(item.get("competency") or "").strip()[:100]
            status = str(item.get("status") or "gap")
            existing = conn.execute(
                """
                SELECT * FROM interview_question_bank
                WHERE profile_id = ? AND lower(question) = lower(?)
                ORDER BY id DESC LIMIT 1
                """,
                (profile_id, question),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE interview_question_bank
                    SET competency = ?, status = ?, times_seen = times_seen + 1,
                        last_job_id = ?, last_seen_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (competency, status, job_id, existing["id"]),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO interview_question_bank (
                        profile_id, strategy_id, question, competency, status, last_job_id
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (profile_id, strategy_id, question[:1000], competency, status, job_id),
                )
        row = conn.execute("SELECT * FROM interview_debriefs WHERE id = ?", (debrief_id,)).fetchone()

    proposed_fact_ids: list[int] = []
    proposed_story_ids: list[int] = []
    for item in questions:
        answer = str(item.get("answer") or "").strip()
        if answer and item.get("new_fact"):
            fact = propose_fact(
                profile_id=profile_id,
                category=str(item.get("fact_category") or "experience"),
                statement=str(item["new_fact"]),
                source_id=source["id"],
                excerpt=answer,
                extraction_method="interview_debrief",
                confidence=0.8,
                db_path=db_path,
            )
            proposed_fact_ids.append(int(fact["id"]))
        story = item.get("story")
        if isinstance(story, dict) and story.get("title"):
            created = create_story(
                profile_id=profile_id,
                strategy_id=strategy_id,
                title=str(story["title"]),
                situation=str(story.get("situation") or ""),
                task=str(story.get("task") or ""),
                action=str(story.get("action") or ""),
                result=str(story.get("result") or ""),
                reflection=str(story.get("reflection") or ""),
                competencies=[str(item.get("competency") or "")],
                fact_ids=proposed_fact_ids,
                status="pending",
                db_path=db_path,
            )
            proposed_story_ids.append(int(created["id"]))
    result = row_to_dict(row) or {}
    result["proposed_fact_ids"] = proposed_fact_ids
    result["proposed_story_ids"] = proposed_story_ids
    return result


def career_patterns(db_path: str | Path | None = None) -> dict[str, Any]:
    with connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT e.*, j.company_name, j.job_title
            FROM application_stage_events e
            JOIN jobs j ON j.id = e.job_id
            ORDER BY e.job_id, e.occurred_at, e.id
            """
        ).fetchall()
    events = rows_to_dicts(rows)
    latest_by_job: dict[int, dict[str, Any]] = {}
    for event in events:
        latest_by_job[int(event["job_id"])] = event
    progressed = [event for event in latest_by_job.values() if event["to_stage"] in PROGRESSED_STAGES]
    counts = Counter(event["to_stage"] for event in latest_by_job.values())
    result: dict[str, Any] = {
        "eligible": len(progressed) >= 5,
        "progressed_count": len(progressed),
        "minimum_required": 5,
        "stage_counts": dict(counts),
        "limitations": [
            "结果只反映当前用户自己记录的求职过程，不代表市场因果",
            "单一策略或来源少于 5 条样本时只展示观察，不给方向性建议",
            "少于 20 条投递记录不生成倍数比较",
        ],
        "recommendations": [],
    }
    if not result["eligible"]:
        return result

    by_strategy: dict[int | None, list[dict[str, Any]]] = defaultdict(list)
    for event in progressed:
        by_strategy[event.get("strategy_id")].append(event)
    strategy_results = []
    for strategy_id, items in by_strategy.items():
        positive = sum(item["to_stage"] in POSITIVE_STAGES for item in items)
        strategy_results.append(
            {
                "strategy_id": strategy_id,
                "total": len(items),
                "positive": positive,
                "advance_rate": round(positive / len(items), 4),
                "sufficient_sample": len(items) >= 5,
            }
        )
    result["strategy_results"] = strategy_results
    sufficient = [item for item in strategy_results if item["sufficient_sample"]]
    if sufficient:
        best = max(sufficient, key=lambda item: item["advance_rate"])
        result["recommendations"].append(
            {
                "type": "strategy_observation",
                "strategy_id": best["strategy_id"],
                "message": "该职业策略在当前个人记录中推进率最高，可优先复核其岗位来源与证据组合。",
                "causal": False,
            }
        )
    return result


def skill_growth_map(db_path: str | Path | None = None) -> dict[str, Any]:
    gaps: Counter[str] = Counter()
    with connect(db_path) as conn:
        evaluation_rows = conn.execute(
            """
            SELECT e.id FROM job_evaluations e
            WHERE e.status IN ('completed', 'partial_failed')
              AND e.id = (
                SELECT MAX(latest.id) FROM job_evaluations latest
                WHERE latest.job_id = e.job_id
                  AND latest.status IN ('completed', 'partial_failed')
              )
            ORDER BY e.id
            """
        ).fetchall()
        question_rows = conn.execute(
            """
            SELECT competency, status, times_seen FROM interview_question_bank
            WHERE status IN ('gap', 'weak', 'red')
            """
        ).fetchall()
    from .job_evaluations import get_job_evaluation
    from .profile_intelligence import extract_skills

    for row in evaluation_rows:
        evaluation = get_job_evaluation(int(row["id"]), db_path=db_path)
        evaluation_gaps: set[str] = set()
        for requirement in evaluation.get("effective_requirements", []):
            if requirement.get("effective_match_status") != "no_evidence":
                continue
            evaluation_gaps.update(extract_skills(str(requirement.get("text") or "")))
        for skill in evaluation_gaps:
            gaps[skill] += 1
    for row in question_rows:
        if row["competency"]:
            gaps[str(row["competency"])] += int(row["times_seen"] or 1)
    items = [
        {
            "skill": skill,
            "frequency": frequency,
            "eligible_for_recommendation": frequency >= 2,
            "reason": "在至少两个独立岗位或面试信号中重复出现" if frequency >= 2 else "单一信号，仅观察",
        }
        for skill, frequency in gaps.most_common()
    ]
    return {"items": items, "rule": "单个 JD 缺口不会直接升级为学习任务"}

from __future__ import annotations

from pathlib import Path
from typing import Any

from .candidate_core import (
    ProfileNotInitializedError,
    active_profile_id,
    create_candidate_source,
    create_story,
    propose_fact,
)
from ..db import connect, json_dump, row_to_dict, rows_to_dicts


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


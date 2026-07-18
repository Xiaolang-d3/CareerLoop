from __future__ import annotations

from typing import Any

from ..api.schemas import CandidateProfileIn
from ..db import connect, json_dump, row_to_dict
from ..knowledge import delete_document, index_document
from ..privacy import scan_and_redact
from ..profile_intelligence import extract_skills
from ..resume_parser import parse_resume_result


def get_candidate_profile() -> dict[str, Any]:
    with connect() as conn:
        profile_row = conn.execute(
            "SELECT * FROM profiles ORDER BY updated_at DESC, id DESC LIMIT 1"
        ).fetchone()
        if profile_row is None:
            return {"profile": None, "preferences": None}
        preference_row = conn.execute(
            "SELECT * FROM preferences WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 1",
            (profile_row["id"],),
        ).fetchone()
    return {
        "profile": row_to_dict(profile_row),
        "preferences": row_to_dict(preference_row),
    }


def save_candidate_profile(payload: CandidateProfileIn) -> dict[str, Any]:
    safe_resume_text = payload.resume_redacted_text
    if payload.resume_text and not safe_resume_text:
        safe_resume_text = scan_and_redact(payload.resume_text)[1]
    with connect() as conn:
        profile = conn.execute(
            "SELECT id FROM profiles ORDER BY updated_at DESC, id DESC LIMIT 1"
        ).fetchone()
        if profile is None:
            cursor = conn.execute(
                """
                INSERT INTO profiles (
                    name, resume_text, resume_filename, resume_redacted_text,
                    privacy_mode, skills_json, projects_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.name,
                    payload.resume_text,
                    payload.resume_filename,
                    safe_resume_text,
                    payload.privacy_mode,
                    json_dump(payload.skills),
                    json_dump(payload.projects),
                ),
            )
            profile_id = cursor.lastrowid
        else:
            profile_id = profile["id"]
            conn.execute(
                """
                UPDATE profiles
                SET name = ?, resume_text = ?, resume_filename = ?, resume_redacted_text = ?,
                    privacy_mode = ?, skills_json = ?, projects_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    payload.name,
                    payload.resume_text,
                    payload.resume_filename,
                    safe_resume_text,
                    payload.privacy_mode,
                    json_dump(payload.skills),
                    json_dump(payload.projects),
                    profile_id,
                ),
            )

        preference_values = (
            json_dump(payload.target_roles),
            json_dump(payload.target_cities),
            payload.salary_min,
            payload.salary_max,
            json_dump(payload.preferred_industries),
            json_dump(payload.blocked_keywords),
            json_dump(payload.blocked_companies),
        )
        preference = conn.execute(
            "SELECT id FROM preferences WHERE profile_id = ? ORDER BY id DESC LIMIT 1",
            (profile_id,),
        ).fetchone()
        if preference is None:
            conn.execute(
                """
                INSERT INTO preferences (
                    profile_id, target_roles_json, target_cities_json,
                    salary_min, salary_max, preferred_industries_json,
                    blocked_keywords_json, blocked_companies_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (profile_id, *preference_values),
            )
        else:
            conn.execute(
                """
                UPDATE preferences
                SET target_roles_json = ?, target_cities_json = ?, salary_min = ?,
                    salary_max = ?, preferred_industries_json = ?, blocked_keywords_json = ?,
                    blocked_companies_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (*preference_values, preference["id"]),
            )
        profile_row = conn.execute(
            "SELECT * FROM profiles WHERE id = ?", (profile_id,)
        ).fetchone()
        preference_row = conn.execute(
            "SELECT * FROM preferences WHERE profile_id = ? ORDER BY id DESC LIMIT 1",
            (profile_id,),
        ).fetchone()

    if payload.resume_text:
        try:
            index_document(
                "resume",
                profile_id,
                payload.resume_filename or "候选人简历",
                safe_resume_text,
            )
        except Exception:
            pass
    else:
        delete_document("resume", profile_id)
    return {
        "profile": row_to_dict(profile_row),
        "preferences": row_to_dict(preference_row),
    }


def parse_candidate_resume(
    filename: str,
    content: bytes,
    mode: str,
) -> dict[str, Any]:
    parsed = parse_resume_result(filename, content, mode)
    findings, redacted_text = scan_and_redact(parsed.text)
    return {
        "filename": filename[:255],
        "text": parsed.text,
        "redacted_text": redacted_text,
        "privacy_findings": findings,
        "suggested_skills": extract_skills(parsed.text),
        "character_count": len(parsed.text),
        "parser": parsed.parser,
        "warnings": parsed.warnings,
        "notice": "仅完成本地文本提取；确认保存前不会写入人物画像。",
    }


def scan_candidate_privacy(text: str) -> dict[str, Any]:
    findings, redacted_text = scan_and_redact(text)
    return {
        "findings": findings,
        "redacted_text": redacted_text,
        "notice": "检测在本机完成；结果用于提醒，保存和是否向 Agent 提供原文仍由你决定。",
    }

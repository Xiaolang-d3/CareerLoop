from __future__ import annotations

from pathlib import Path
from typing import Any

from ..profile.intelligence import analyze_resume, apply_resume_rewrite
from ..tools.local_data import profile_for_agent, resolve_profile


def analyze_job_description(
    job_description: str = "",
    *,
    job_title: str = "",
    company_name: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Analyze the saved resume. Job/JD is optional and not persisted.

    With no JD, this returns resume-centered strengths, gaps, structure and
    project talking points. With a substantial JD, it also adds skill match.
    """
    description = job_description.strip()
    profile, _preferences = resolve_profile(None, db_path)
    if profile is None:
        raise ValueError("请先在个人资料中上传并保存简历")

    safe_profile = profile_for_agent(profile)
    if not str(safe_profile.get("resume_text") or "").strip():
        raise ValueError("请先在个人资料中上传并保存简历")

    job = None
    extra_limitations: list[str] = []
    if len(description) >= 20:
        job = {
            "title": job_title,
            "description": description,
            "experience": "",
            "education": "",
        }
    elif description:
        extra_limitations.append("岗位描述过短，这次只分析了简历本身")

    analysis = analyze_resume(safe_profile, job)
    if extra_limitations:
        analysis["limitations"] = [*analysis.get("limitations", []), *extra_limitations]
    return {
        "job": {
            "title": job_title.strip()[:200],
            "company_name": company_name.strip()[:200],
            "description_character_count": len(description),
        },
        "analysis": analysis,
        "persistence": "not_saved_as_job",
    }


def apply_resume_rewrite_and_analyze(
    original: str,
    suggested: str,
    *,
    job_description: str = "",
    job_title: str = "",
    company_name: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Write one suggested rewrite into the saved resume, then re-analyze."""
    from ..profile.candidate_core import create_candidate_source

    profile, _preferences = resolve_profile(None, db_path)
    if profile is None:
        raise ValueError("请先在个人资料中上传并保存简历")
    resume_text = str(profile.get("resume_text") or "").strip()
    if not resume_text:
        raise ValueError("请先在个人资料中上传并保存简历")

    updated = apply_resume_rewrite(resume_text, original, suggested)
    privacy_mode = str(profile.get("privacy_mode") or "redacted")
    create_candidate_source(
        source_type="resume",
        title=str(profile.get("resume_filename") or "").strip() or "候选人简历",
        content=updated,
        privacy_mode=privacy_mode,
        allow_model_original=privacy_mode == "original",
        db_path=db_path,
    )
    result = analyze_job_description(
        job_description,
        job_title=job_title,
        company_name=company_name,
        db_path=db_path,
    )
    result["resume_text"] = updated
    result["applied"] = {"original": original.strip(), "suggested": suggested.strip()}
    return result

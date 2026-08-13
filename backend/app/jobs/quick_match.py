from __future__ import annotations

from pathlib import Path
from typing import Any

from ..profile.intelligence import analyze_resume
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

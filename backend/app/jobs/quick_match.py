from __future__ import annotations

from pathlib import Path
from typing import Any

from ..profile_intelligence import analyze_gap
from ..tools.local_data import profile_for_agent, resolve_profile


def analyze_job_description(
    job_description: str,
    *,
    job_title: str = "",
    company_name: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    """Return a private, non-persistent first-pass JD match.

    This deliberately does not create a job or an evaluation record. It is the
    low-friction entry point before a candidate decides a role is worth saving.
    """
    description = job_description.strip()
    if len(description) < 20:
        raise ValueError("岗位 JD 至少需要 20 个字符才能开始匹配")

    profile, _preferences = resolve_profile(None, db_path)
    if profile is None:
        raise ValueError("请先完成职业资料或导入简历，再进行快速匹配")

    safe_profile = profile_for_agent(profile)
    return {
        "job": {
            "title": job_title.strip()[:200],
            "company_name": company_name.strip()[:200],
            "description_character_count": len(description),
        },
        "analysis": analyze_gap(
            {"title": job_title, "description": description, "experience": "", "education": ""},
            safe_profile,
        ),
        "persistence": "not_saved_as_job",
    }

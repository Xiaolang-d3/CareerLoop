from unittest.mock import patch

import pytest

from app.jobs.quick_match import analyze_job_description


def test_quick_match_analyzes_jd_without_creating_a_job() -> None:
    profile = {
        "privacy_mode": "redacted",
        "resume_text": "负责使用 Python 和 FastAPI 交付内部服务。",
        "resume_redacted_text": "负责使用 Python 和 FastAPI 交付内部服务。",
        "skills": ["Python", "FastAPI"],
    }
    with patch("app.jobs.quick_match.resolve_profile", return_value=(profile, None)):
        result = analyze_job_description(
            "负责开发 Python 服务，要求熟悉 FastAPI、Docker 和 SQL。",
            job_title="后端工程师",
            company_name="示例公司",
        )

    assert result["persistence"] == "not_saved_as_job"
    assert result["job"]["title"] == "后端工程师"
    assert result["analysis"]["matched_skills"] == ["Python", "FastAPI"]
    assert result["analysis"]["missing_skills"] == ["SQL", "Docker"]


def test_quick_match_requires_a_substantial_job_description() -> None:
    with pytest.raises(ValueError, match="至少需要 20 个字符"):
        analyze_job_description("Python 岗位")

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


def test_quick_match_analyzes_saved_resume_without_a_job_description() -> None:
    profile = {
        "privacy_mode": "redacted",
        "resume_text": "技能：Python、FastAPI\n项目经历\n内部网关\n- 使用 FastAPI 交付内部服务。",
        "resume_redacted_text": "技能：Python、FastAPI\n项目经历\n内部网关\n- 使用 FastAPI 交付内部服务。",
        "skills": ["Python", "FastAPI"],
    }
    with patch("app.jobs.quick_match.resolve_profile", return_value=(profile, None)):
        result = analyze_job_description("")

    assert result["persistence"] == "not_saved_as_job"
    assert result["analysis"]["mode"] == "resume_only"
    assert "Python" in result["analysis"]["resume"]["skills"]
    assert result["analysis"]["resume"]["projects"]


def test_quick_match_requires_a_saved_resume() -> None:
    with patch("app.jobs.quick_match.resolve_profile", return_value=(None, None)):
        with pytest.raises(ValueError, match="上传并保存简历"):
            analyze_job_description("")

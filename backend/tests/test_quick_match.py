from unittest.mock import patch

import pytest

from app import db
from app.jobs.quick_match import analyze_job_description, apply_resume_rewrite_and_analyze
from app.main import app
from api_client import create_authenticated_client


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


def test_apply_resume_rewrite_saves_resume_and_reanalyzes() -> None:
    profile = {
        "privacy_mode": "redacted",
        "resume_filename": "cv.txt",
        "resume_text": (
            "技能：Python、FastAPI\n"
            "项目经历\n内部网关\n"
            "- 使用 FastAPI 交付内部服务。\n"
            "- 负责接口联调。\n"
        ),
        "resume_redacted_text": "",
        "skills": ["Python", "FastAPI"],
    }
    saved: dict[str, str] = {}

    def fake_create_source(**kwargs):
        saved["content"] = kwargs["content"]
        profile["resume_text"] = kwargs["content"]
        return {"id": 1}

    with (
        patch("app.jobs.quick_match.resolve_profile", return_value=(profile, None)),
        patch("app.profile.candidate_core.create_candidate_source", side_effect=fake_create_source),
    ):
        first = analyze_job_description("")
        rewrite = first["analysis"]["resume"]["projects"][0]["rewrite"]
        result = apply_resume_rewrite_and_analyze(rewrite["original"], rewrite["suggested"])

    assert rewrite["suggested"] in saved["content"]
    assert result["resume_text"] == saved["content"]
    assert result["applied"]["suggested"] == rewrite["suggested"]
    assert result["analysis"]["mode"] == "resume_only"
    assert any("待补充" in item["title"] for item in result["analysis"]["resume"]["next_actions"])


def test_quick_match_run_accepts_post_for_live_analysis(tmp_path, monkeypatch) -> None:
    async def fake_events(*_args, **_kwargs):
        yield {"type": "error", "message": "请先在个人资料中上传并保存简历"}

    monkeypatch.setattr(db, "DB_PATH", tmp_path / "quick-match.db")
    db.init_db()
    client = create_authenticated_client(app)

    with patch("app.api.resources.iter_analysis_run_events", fake_events):
        post_response = client.post(
            "/quick-match/run",
            json={"job_description": "", "job_title": "", "company_name": ""},
        )

    assert post_response.status_code != 405
    assert post_response.status_code == 200
    assert "text/event-stream" in post_response.headers.get("content-type", "")
    assert "请先在个人资料中上传并保存简历" in post_response.text
    client.close()

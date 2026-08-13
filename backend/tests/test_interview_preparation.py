import asyncio
import json
from pathlib import Path

from app.profile.candidate_core import create_or_update_profile
from app.db import init_db
from app.interview.preparation import (
    add_interview_preparation_record,
    analyze_interview_preparation_jd,
    give_interview_preparation_feedback,
    get_interview_preparation,
    review_interview_preparation_fragment,
    select_interview_preparation_projects,
    start_interview_preparation_resume_analysis,
    update_interview_preparation_node,
)
import app.interview.preparation as interview_preparation
from app.profile import document as profile_document


def _profile(tmp_path: Path) -> Path:
    db_path = tmp_path / "interview-prep.db"
    init_db(db_path)
    create_or_update_profile(name="测试候选人", db_path=db_path)
    profile_document.update(
        db_path,
        resume_text="""
项目经历
AI 求职助手项目
- 使用 FastAPI、React 和 SQLite 开发求职助手，负责简历解析与岗位评估模块。
- 将人工整理时间降低 35%。
""",
    )
    return db_path


def test_preparation_returns_an_actionable_first_run_state(tmp_path: Path) -> None:
    db_path = tmp_path / "empty-interview-prep.db"
    init_db(db_path)

    preparation = get_interview_preparation(db_path)

    assert preparation["has_profile"] is False
    assert preparation["has_resume"] is False
    assert preparation["experiences"] == []


def test_preparation_is_derived_from_resume_evidence_and_marks_nodes_complete(tmp_path: Path) -> None:
    db_path = _profile(tmp_path)

    preparation = get_interview_preparation(db_path)

    assert preparation["has_profile"] is True
    assert preparation["has_resume"] is True
    assert preparation["experiences"]
    experience = preparation["experiences"][0]
    assert "FastAPI" in experience["evidence"]
    assert any("具体负责" in node["title"] for node in experience["questions"])
    assert any("FastAPI" in node["title"] for node in experience["knowledge"])
    assert any("FastAPI" in node["title"] for node in preparation["general_knowledge"])

    node_id = experience["knowledge"][0]["id"]
    updated = update_interview_preparation_node(node_id, completed=True, db_path=db_path)
    refreshed = next(item for item in updated["experiences"] if item["id"] == experience["id"])
    assert next(item for item in refreshed["knowledge"] if item["id"] == node_id)["completed"] is True


def test_preparation_reuses_a_payload_when_the_resume_and_state_are_unchanged(tmp_path: Path, monkeypatch) -> None:
    db_path = _profile(tmp_path)
    original = interview_preparation._project_blocks
    calls = 0

    def counted_project_blocks(resume_text: str, facts: list[str]):
        nonlocal calls
        calls += 1
        return original(resume_text, facts)

    monkeypatch.setattr(interview_preparation, "_project_blocks", counted_project_blocks)

    first = get_interview_preparation(db_path)
    second = get_interview_preparation(db_path)

    assert first == second
    assert calls == 1


def test_preparation_only_lists_explicit_project_blocks_and_keeps_other_resume_lines_unclassified(tmp_path: Path) -> None:
    db_path = tmp_path / "project-triage.db"
    init_db(db_path)
    create_or_update_profile(name="测试候选人", db_path=db_path)
    profile_document.update(
        db_path,
        resume_text="""
求职方向：AI 应用工程师
工作经历
89Trillion｜AI 应用工程师｜2025.07 - 至今
负责服务稳定性与线上排障。
项目经历
智能会议总结（Summary）
- 基于 LangChain 搭建统一 LLM 接入网关。
- 将新模型接入周期由 3 天缩短至 4 小时。
技能：Python、FastAPI
""",
    )

    preparation = get_interview_preparation(db_path)

    assert [item["title"] for item in preparation["experiences"]] == ["智能会议总结（Summary）"]
    assert "LLM 接入网关" in preparation["experiences"][0]["evidence"]
    assert "求职方向：AI 应用工程师" in [item["text"] for item in preparation["unclassified_fragments"]]
    assert "89Trillion｜AI 应用工程师｜2025.07 - 至今" in [item["text"] for item in preparation["unclassified_fragments"]]
    assert "技能：Python、FastAPI" in [item["text"] for item in preparation["unclassified_fragments"]]


def test_preparation_falls_back_to_conservative_project_candidates_when_heading_is_missing(tmp_path: Path) -> None:
    db_path = tmp_path / "project-fallback.db"
    init_db(db_path)
    create_or_update_profile(name="测试候选人", db_path=db_path)
    profile_document.update(
        db_path,
        resume_text="""
工作经历
某公司｜AI 应用工程师
智能求职项目
- 使用 FastAPI 和 React 开发简历解析与岗位匹配功能。
- 将人工整理时间降低 35%。
技能：Python、FastAPI
""",
    )

    preparation = get_interview_preparation(db_path)

    assert preparation["experiences"]
    assert preparation["experiences"][0]["title"] == "智能求职项目"


def test_preparation_can_ignore_an_unclassified_fragment(tmp_path: Path) -> None:
    db_path = tmp_path / "project-fragment-review.db"
    init_db(db_path)
    create_or_update_profile(name="测试候选人", db_path=db_path)
    profile_document.update(db_path, resume_text="求职方向：AI 应用工程师\n项目经历\n智能会议总结\n- 完成会议总结功能。")

    before = get_interview_preparation(db_path)
    fragment_id = before["unclassified_fragments"][0]["id"]
    after = review_interview_preparation_fragment(fragment_id, action="ignore", db_path=db_path)

    assert after["unclassified_fragments"] == []
    assert after["ignored_fragment_count"] == 1


def test_model_structure_classifies_resume_without_manual_fragment_triage(tmp_path: Path, monkeypatch) -> None:
    db_path = _profile(tmp_path)

    class FakeProvider:
        def __init__(self, **_kwargs) -> None:
            pass

        async def generate(self, _request):
            return type("Response", (), {"content": json.dumps({
                "modules": [
                    {"key": "skills", "label": "专业技能", "fields": [
                        {"label": "技术栈", "value": "FastAPI、React、SQLite"},
                        {"label": "邮箱", "value": "candidate@example.com"},
                    ]},
                ],
                "projects": [
                    {
                        "title": "AI 求职助手项目",
                        "evidence": "AI 求职助手项目\n- 使用 FastAPI、React 和 SQLite 开发求职助手，负责简历解析与岗位评估模块。\n- 将人工整理时间降低 35%。",
                        "fields": [
                            {"label": "个人职责", "value": "负责简历解析与岗位评估模块"},
                            {"label": "结果", "value": "人工整理时间降低 35%"},
                        ],
                    },
                ],
            })})()

    monkeypatch.setattr(interview_preparation, "OpenAICompatibleProvider", FakeProvider)
    monkeypatch.setattr(
        interview_preparation,
        "get_model_connection",
        lambda _db_path: {"api_key": "test", "model_name": "test-model", "model_base_url": ""},
    )

    prepared = asyncio.run(interview_preparation.analyze_interview_preparation_resume(db_path))

    assert prepared["unclassified_fragments"] == []
    assert prepared["classified_fragment_count"] == 4
    assert prepared["resume_structure"]["modules"][0]["label"] == "专业技能"
    assert prepared["resume_structure"]["modules"][0]["fields"] == [{
        "label": "技术栈", "value": "FastAPI、React、SQLite",
    }]
    assert prepared["experiences"][0]["title"] == "AI 求职助手项目"
    assert prepared["experiences"][0]["fields"][0]["label"] == "个人职责"


def test_resume_structure_analysis_runs_in_background_and_exposes_its_status(tmp_path: Path, monkeypatch) -> None:
    db_path = _profile(tmp_path)

    class FakeProvider:
        def __init__(self, **_kwargs) -> None:
            pass

        async def generate(self, _request):
            await asyncio.sleep(0)
            return type("Response", (), {"content": json.dumps({
                "modules": [{"key": "skills", "label": "技能", "fields": [{"label": "技术栈", "value": "FastAPI、React"}]}],
                "projects": [{"title": "AI 求职助手项目", "evidence": "AI 求职助手项目\n- 使用 FastAPI、React 和 SQLite 开发求职助手，负责简历解析与岗位评估模块。", "fields": []}],
            })})()

    monkeypatch.setattr(interview_preparation, "OpenAICompatibleProvider", FakeProvider)
    monkeypatch.setattr(interview_preparation, "get_model_connection", lambda _db_path: {"api_key": "test", "model_name": "test", "model_base_url": ""})

    async def run() -> None:
        started = await start_interview_preparation_resume_analysis(db_path)
        assert started["resume_analysis"]["status"] == "running"
        await asyncio.sleep(0.02)
        assert get_interview_preparation(db_path)["resume_analysis"]["status"] == "completed"

    asyncio.run(run())


def test_preparation_uses_work_module_as_a_candidate_when_model_returns_no_projects(tmp_path: Path, monkeypatch) -> None:
    db_path = _profile(tmp_path)

    class FakeProvider:
        def __init__(self, **_kwargs) -> None:
            pass

        async def generate(self, _request):
            return type("Response", (), {"content": json.dumps({
                "modules": [
                    {"key": "education", "label": "教育经历", "fields": [{"label": "学校", "value": "某大学"}]},
                    {"key": "work", "label": "工作经历", "fields": [{"label": "职责", "value": "负责简历解析与岗位评估模块"}]},
                ],
                "projects": [],
            })})()

    monkeypatch.setattr(interview_preparation, "OpenAICompatibleProvider", FakeProvider)
    monkeypatch.setattr(interview_preparation, "get_model_connection", lambda _db_path: {"api_key": "test", "model_name": "test", "model_base_url": ""})

    prepared = asyncio.run(interview_preparation.analyze_interview_preparation_resume(db_path))

    assert len(prepared["experiences"]) == 1
    assert prepared["experiences"][0]["title"] == "工作经历（待确认）"
    assert "简历解析" in prepared["experiences"][0]["evidence"]


def test_preparation_marks_saved_state_stale_after_resume_changes(tmp_path: Path) -> None:
    db_path = _profile(tmp_path)
    first = get_interview_preparation(db_path)
    node_id = first["experiences"][0]["questions"][0]["id"]
    update_interview_preparation_node(node_id, completed=True, db_path=db_path)

    profile_document.update(db_path, resume_text="- 使用 FastAPI 完成新的服务模块。")

    assert get_interview_preparation(db_path)["stale"] is True


def test_jd_flow_generates_rewrite_questions_and_answer_feedback(tmp_path: Path, monkeypatch) -> None:
    db_path = _profile(tmp_path)
    project_id = get_interview_preparation(db_path)["experiences"][0]["id"]
    select_interview_preparation_projects([project_id], db_path=db_path)

    class FakeProvider:
        calls = 0

        def __init__(self, **_kwargs) -> None:
            pass

        async def generate(self, _request):
            FakeProvider.calls += 1
            if FakeProvider.calls == 1:
                content = {
                    "summary": {"fit": "具备核心开发经历", "matched": ["FastAPI 服务开发"], "gaps": ["补充稳定性取舍"]},
                    "projects": [{
                        "id": project_id,
                        "rewrite": "使用 FastAPI、React 和 SQLite 开发求职助手，负责简历解析与岗位评估模块，使人工整理时间降低 35%。",
                        "questions": [{"id": "ignored", "question": "你如何设计简历解析模块？", "focus": "系统设计与取舍"}],
                    }],
                }
            else:
                content = {"strengths": ["说明了负责范围"], "gaps": ["补充具体取舍"], "next_attempt": "用项目中的解析流程说明你的决策。"}
            return type("Response", (), {"content": json.dumps(content)})()

    monkeypatch.setattr(interview_preparation, "OpenAICompatibleProvider", FakeProvider)
    monkeypatch.setattr(
        interview_preparation,
        "get_model_connection",
        lambda _db_path: {"api_key": "test", "model_name": "test-model", "model_base_url": ""},
    )

    prepared = asyncio.run(analyze_interview_preparation_jd(
        "负责 AI 应用后端服务与稳定性建设，熟悉 FastAPI、React 和数据处理流程。",
        db_path=db_path,
    ))

    analysis = prepared["job_analysis"]
    assert analysis["projects"][0]["rewrite"]
    question_id = analysis["projects"][0]["questions"][0]["id"]
    feedback = asyncio.run(give_interview_preparation_feedback(
        question_id, "我负责简历解析服务的接口设计与前端交付，并持续优化解析流程。", db_path=db_path,
    ))
    assert feedback["feedback"]["strengths"] == ["说明了负责范围"]


def test_preparation_keeps_interview_records_independent_from_a_job(tmp_path: Path) -> None:
    db_path = _profile(tmp_path)

    prepared = add_interview_preparation_record(
        title="Agent 系统设计练习",
        summary="被问到工具调用如何做权限隔离；下次补充审计与失败恢复的回答。",
        occurred_on="2026-08-11",
        db_path=db_path,
    )

    assert prepared["interview_records"] == [{
        "id": prepared["interview_records"][0]["id"],
        "title": "Agent 系统设计练习",
        "summary": "被问到工具调用如何做权限隔离；下次补充审计与失败恢复的回答。",
        "occurred_on": "2026-08-11",
    }]

import asyncio
from pathlib import Path

from app.db import init_db
from app.profile import document as profile_document
from app.profile.candidate_core import create_or_update_profile
from app.projects.briefing import analyze_project_briefing, build_project_briefing, get_project_studio


def _profile(tmp_path: Path) -> Path:
    db_path = tmp_path / "project-studio.db"
    init_db(db_path)
    create_or_update_profile(name="测试候选人", db_path=db_path)
    profile_document.update(
        db_path,
        resume_text="""
项目经历
智能会议总结（Summary）
- 基于 LangChain 搭建统一 LLM 接入网关。
- 将新模型接入周期由 3 天缩短至 4 小时。
""",
    )
    return db_path


def test_description_briefing_keeps_resume_facts_and_builds_a_chain() -> None:
    briefing = build_project_briefing(
        title="智能会议总结",
        evidence="智能会议总结\n- 基于 LangChain 搭建统一 LLM 接入网关。\n- 将新模型接入周期由 3 天缩短至 4 小时。",
        fields=[
            {"label": "个人职责", "value": "负责统一 LLM 接入网关"},
            {"label": "技术方案", "value": "LangChain + 多厂商模型路由"},
            {"label": "结果", "value": "新模型接入周期由 3 天缩短至 4 小时"},
        ],
    )

    assert briefing["source_kind"] == "description"
    assert "LangChain" in briefing["stack"]
    assert "LLM" in briefing["stack"]
    assert briefing["core"] == "负责统一 LLM 接入网关"
    assert [layer["name"] for layer in briefing["layers"]] == ["职责", "方案", "结果"]
    assert "flowchart LR" in briefing["mermaid"]
    assert "Kafka" not in briefing["stack"]


def test_description_briefing_splits_client_and_server_when_the_text_has_both() -> None:
    briefing = build_project_briefing(
        title="实时语音链路",
        evidence="麦克风 PCM 采集后做 Ogg/Opus 编码并分片上行。服务端接收后走 ASR 转写，再进入 LLM 网关。Redis 缓存用于降本。",
    )

    assert [layer["name"] for layer in briefing["layers"]] == ["客户端", "服务端", "数据与链路"]
    assert any("Opus" in step["detail"] or "采集" in step["detail"] for step in briefing["layers"][0]["steps"])
    assert any("ASR" in step["detail"] or "转写" in step["detail"] for step in briefing["layers"][1]["steps"])
    assert "Opus" in briefing["stack"]
    assert "ASR" in briefing["stack"]
    assert "Redis" in briefing["stack"]


def test_code_briefing_uses_file_paths_instead_of_inventing_architecture() -> None:
    briefing = build_project_briefing(
        title="实时语音链路",
        evidence="实时语音转写与问答。",
        code_excerpt="""
frontend/src/audio/capture.ts
frontend/src/audio/opus.ts
backend/app/asr.py
backend/app/llm_gateway.py
""",
        source_kind="code",
    )

    assert briefing["source_kind"] == "code"
    assert [layer["name"] for layer in briefing["layers"]] == ["客户端", "服务端"]
    assert [step["detail"] for step in briefing["layers"][0]["steps"]] == [
        "frontend/src/audio/capture.ts",
        "frontend/src/audio/opus.ts",
    ]
    assert "llm_gateway.py" in briefing["layers"][1]["steps"][1]["detail"]
    assert "Kafka" not in briefing["stack"]


def test_studio_lists_resume_projects_and_can_save_a_code_briefing(tmp_path: Path) -> None:
    db_path = _profile(tmp_path)

    studio = get_project_studio(db_path)
    assert studio["has_profile"] is True
    assert studio["projects"]
    project_id = studio["projects"][0]["id"]
    assert studio["projects"][0]["briefing"]["layers"]

    updated = asyncio.run(analyze_project_briefing(
        project_id,
        source_kind="code",
        description="麦克风采集后流式上行。",
        code_excerpt="frontend/src/audio/capture.ts\nbackend/app/asr.py",
        db_path=db_path,
    ))
    briefing = next(item["briefing"] for item in updated["projects"] if item["id"] == project_id)
    assert briefing["source_kind"] == "code"
    assert briefing["description"] == "麦克风采集后流式上行。"
    assert [layer["name"] for layer in briefing["layers"]] == ["客户端", "服务端"]

    reloaded = get_project_studio(db_path)
    assert reloaded["projects"][0]["briefing"]["code_excerpt"].startswith("frontend/src/audio/capture.ts")

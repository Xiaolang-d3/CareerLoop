from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.domain import ModelResponse, ModelStreamEvent
from app.models import ModelProviderError
from app.profile import analysis_run


def _local_result() -> dict[str, Any]:
    return {
        "job": {"title": "", "company_name": "", "description_character_count": 0},
        "persistence": "not_saved_as_job",
        "analysis": {
            "mode": "resume_only",
            "required_skills": [],
            "matched_skills": ["Python"],
            "missing_skills": [],
            "evidence": [],
            "skill_coverage": None,
            "confidence": "limited",
            "limitations": ["未提供具体岗位，以下是对已保存简历本身的分析"],
            "resume": {
                "headline": {"verdict": "能看出你会 Python。", "remember": "", "skip": ""},
                "scan": {
                    "identity": "张三",
                    "target": "后端工程师",
                    "proof": {"metric_lines": 1, "evidence_lines": 2},
                },
                "checklist": [
                    {"key": "direction", "title": "方向匹配", "summary": "张三 · 后端工程师。"},
                    {"key": "project_evidence", "title": "项目证据", "summary": "有 1 段可引用经历。"},
                    {"key": "quantified", "title": "量化结果", "summary": "1 条带数字。"},
                    {"key": "risks", "title": "风险/缺口", "summary": "结构上看不到教育经历"},
                    {"key": "next_step", "title": "下一步", "summary": "先补教育经历"},
                ],
                "projects": [{"title": "内部工具", "weak": False}],
                "talking_source": "project",
                "gaps": ["结构上看不到教育经历"],
                "structure": {"found": ["项目经历"], "missing": ["教育经历"]},
                "next_actions": [{"title": "补上教育经历", "detail": "去个人资料补模块。"}],
            },
        },
    }


def _collect(**kwargs: Any) -> list[dict[str, Any]]:
    return asyncio.run(analysis_run.collect_analysis_run_events(**kwargs))


def test_analysis_run_without_api_key_walks_local_steps(monkeypatch: pytest.MonkeyPatch) -> None:
    local = _local_result()
    monkeypatch.setattr(analysis_run, "analyze_job_description", lambda *_args, **_kwargs: local)
    monkeypatch.setattr(
        analysis_run,
        "get_model_connection",
        lambda _db_path=None: {"api_key": "", "model_name": "test", "model_base_url": ""},
    )

    events = _collect()
    steps = [event for event in events if event["type"] == "step"]
    thoughts = [event for event in events if event["type"] == "thought"]
    result_event = next(event for event in events if event["type"] == "result")

    assert steps[0]["key"] == "direction"
    assert steps[0]["status"] == "running"
    assert steps[0]["source"] == "local"
    assert [event["key"] for event in steps if event["status"] == "done"] == [
        "direction",
        "project_evidence",
        "quantified",
        "risks",
        "next_step",
    ]
    assert all(event["source"] == "local" for event in steps)
    assert any("本地规则" in event["text"] for event in thoughts)
    assert any("带数字" in event["text"] for event in thoughts)
    assert result_event["source"] == "local"
    assert "本次为本地分析，未调用模型" in result_event["result"]["analysis"]["limitations"]


def test_analysis_run_model_error_falls_back_to_local(monkeypatch: pytest.MonkeyPatch) -> None:
    local = _local_result()
    monkeypatch.setattr(analysis_run, "analyze_job_description", lambda *_args, **_kwargs: local)
    monkeypatch.setattr(
        analysis_run,
        "get_model_connection",
        lambda _db_path=None: {"api_key": "test-key", "model_name": "test", "model_base_url": ""},
    )

    class FakeProvider:
        def __init__(self, **_kwargs: Any) -> None:
            pass

        async def stream(self, _request: Any):
            raise ModelProviderError("timeout", "模型超时")
            yield  # pragma: no cover

    monkeypatch.setattr(analysis_run, "build_model_provider", FakeProvider)

    events = _collect()
    result_event = next(event for event in events if event["type"] == "result")
    next_done = next(
        event for event in events
        if event["type"] == "step" and event["key"] == "next_step" and event["status"] == "done"
    )

    assert result_event["source"] == "local_fallback"
    assert next_done["source"] == "local_fallback"
    assert result_event["result"]["analysis"]["resume"]["headline"]["verdict"] == "能看出你会 Python。"
    assert "模型润色失败，已保留本地分析结果" in result_event["result"]["analysis"]["limitations"]


def test_analysis_run_model_stream_enriches_wording(monkeypatch: pytest.MonkeyPatch) -> None:
    local = _local_result()
    monkeypatch.setattr(analysis_run, "analyze_job_description", lambda *_args, **_kwargs: local)
    monkeypatch.setattr(
        analysis_run,
        "get_model_connection",
        lambda _db_path=None: {"api_key": "test-key", "model_name": "test", "model_base_url": ""},
    )

    class FakeProvider:
        def __init__(self, **_kwargs: Any) -> None:
            pass

        async def stream(self, _request: Any):
            yield ModelStreamEvent(type="text_delta", delta='{"thinking":')
            yield ModelStreamEvent(
                type="completed",
                response=ModelResponse(
                    content=(
                        '{"thinking":"对照了清单，没有补写数字。",'
                        '"checklist":[{"key":"direction","summary":"润色后的方向","thinking":"只看了意向字段"}],'
                        '"headline":{"verdict":"更清楚的第一印象"},'
                        '"next_actions":[{"title":"先补教育模块","detail":"去个人资料补。"}]}'
                    )
                ),
            )

    monkeypatch.setattr(analysis_run, "build_model_provider", FakeProvider)

    events = _collect()
    result_event = next(event for event in events if event["type"] == "result")
    thoughts = [event["text"] for event in events if event["type"] == "thought"]
    next_running = [
        event for event in events
        if event["type"] == "step" and event["key"] == "next_step" and event["status"] == "running"
    ]

    assert result_event["source"] == "model"
    assert any(event["source"] == "model" for event in next_running)
    assert result_event["result"]["analysis"]["resume"]["headline"]["verdict"] == "更清楚的第一印象"
    assert result_event["result"]["analysis"]["resume"]["checklist"][0]["summary"] == "润色后的方向"
    assert result_event["result"]["analysis"]["resume"]["next_actions"][0]["title"] == "先补教育模块"
    assert "对照了清单，没有补写数字。" in thoughts
    assert "只看了意向字段" in thoughts


def test_apply_model_refine_does_not_invent_checklist_keys() -> None:
    result = _local_result()
    analysis_run.apply_model_refine(
        result,
        {
            "checklist": [{"key": "invented", "summary": "不该出现"}],
            "headline": {"verdict": "可以改的表述"},
        },
    )
    keys = [item["key"] for item in result["analysis"]["resume"]["checklist"]]
    assert "invented" not in keys
    assert result["analysis"]["resume"]["headline"]["verdict"] == "可以改的表述"

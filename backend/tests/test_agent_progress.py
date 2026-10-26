"""Multi-turn regressions for preserving facts and delivering usable work."""
from __future__ import annotations

import asyncio

from app.agent.citations import evidence_cards
from app.agent.resume_policy import clarification_context, relevant_clarification_history
from app.agent.runtime import _web_source_urls
from app.domain import AgentClarification, AgentMessage, AgentRunSnapshot


def test_repeated_clarification_keeps_original_goal_full_material_and_draft():
    material = "项目说明：" + "甲" * 1500 + "技术栈 FastAPI / SQLite"
    snapshot = AgentRunSnapshot(
        route_kind="content_creation", needs_plan=False,
        messages=[AgentMessage(role="user", content="为2025届、10个月经验的候选人写简历"),
                  AgentMessage(role="user", content=material),
                  AgentMessage(role="assistant", content="CareerLoop 项目经历初稿"),
                  AgentMessage(role="system", content="过期计划，不应复用"),
                  *[AgentMessage(role="user", content=f"补充信息 {i}") for i in range(6)]],
        clarification=AgentClarification(question="项目的技术栈是什么？"),
    )
    for _ in range(6):
        context, history, _ = clarification_context(snapshot)
        assert "2025届、10个月经验" in context
        assert material in context
        assert any(message.content == "CareerLoop 项目经历初稿" for message in history)
        assert "过期计划" not in str(history)
        snapshot = snapshot.model_copy(update={"messages": [*history, AgentMessage(role="user", content="继续补充")]})


def test_read_evidence_survives_as_data_without_replaying_tool_calls():
    payload = {"tool_name": "search_public_web", "status": "done", "sources": [
        {"url": "https://example.com/source", "content": "公开证据内容"},
    ]}
    snapshot = AgentRunSnapshot(route_kind="content_creation", needs_plan=False, messages=[
        AgentMessage(role="assistant", payload={"tool_calls": [{"id": "old", "name": "search_public_web"}]}),
        AgentMessage(role="tool", tool_call_id="old", payload=payload),
    ])
    _, history, _ = clarification_context(snapshot)
    assert len(history) == 1 and history[0].role == "assistant"
    assert "公开证据内容" in history[0].content
    assert not history[0].payload.get("tool_calls") and history[0].tool_call_id is None
    assert _web_source_urls(history) == {"https://example.com/source"}
    assert evidence_cards(history, "")[0]["excerpt"] == "公开证据内容"


def test_public_source_switch_drops_private_evidence_without_losing_user_facts():
    snapshot = AgentRunSnapshot(route_kind="library_search", needs_plan=False, messages=[
        AgentMessage(role="user", content="我明确提供的事实"),
        AgentMessage(role="tool", payload={"status": "done", "tool_name": "search_library", "excerpt": "私人原文"}),
    ])
    _, history, _ = clarification_context(snapshot)
    assert "私人原文" in str(relevant_clarification_history(history, ("search_library",)))
    public = relevant_clarification_history(history, ("search_public_web",))
    assert "私人原文" not in str(public)
    assert public[0].content == "我明确提供的事实"

from __future__ import annotations

import asyncio

from app.agent.egress_policy import (
    APPROVE_OPTION_LABEL,
    DECLINE_OPTION_LABEL,
    EgressState,
    approval_payload,
    normalize_query,
    query_digest,
    resolve_egress_reply,
)
from app.tools import SearchPublicWebTool, ToolContext


def test_normalize_query_collapses_whitespace_and_case() -> None:
    assert normalize_query("  OpenAI   News ") == "openai news"
    assert query_digest("OpenAI News") == query_digest("openai  news")


def test_non_mixed_state_allows_everything() -> None:
    state = EgressState()
    assert state.allows("任意查询")


def test_mixed_state_requires_exact_approval() -> None:
    state = EgressState(mixed=True)
    assert not state.allows("最新 AI 新闻")
    state.approve(["最新 AI 新闻"])
    assert state.allows("最新 AI 新闻")
    assert state.allows("  最新   AI 新闻 ")
    assert not state.allows("另一条查询")


def test_hold_replaces_pending_and_approve_clears_it() -> None:
    state = EgressState(mixed=True)
    state.hold("第一条")
    state.hold("第二条")
    assert state.pending == ["第二条"]
    state.approve(["第二条"])
    assert state.pending == []
    assert state.approved == ["第二条"]


def test_revoke_stops_being_mixed_and_forgets_approvals() -> None:
    state = EgressState(mixed=True, approved=["查询"], pending=["查询"])
    state.revoke()
    assert state.mixed is False
    assert state.approved == []
    assert state.pending == []
    assert state.allows("查询")


def test_resolve_reply_approve_label_approves_pending_exactly() -> None:
    decision = resolve_egress_reply(APPROVE_OPTION_LABEL, ["待批查询"])
    assert decision.approved_queries == ("待批查询",)
    assert not decision.declined


def test_resolve_reply_decline_label_revokes() -> None:
    decision = resolve_egress_reply(DECLINE_OPTION_LABEL, ["待批查询"])
    assert decision.declined
    assert decision.approved_queries == ()


def test_resolve_reply_other_text_is_a_user_supplied_query() -> None:
    decision = resolve_egress_reply("帮我查 2026 年光伏行业政策", ["待批查询"])
    assert decision.approved_queries == ("帮我查 2026 年光伏行业政策",)
    assert not decision.declined


def test_resolve_reply_empty_or_too_long_stays_unresolved() -> None:
    assert resolve_egress_reply("   ", ["待批查询"]).approved_queries == ()
    long_reply = "很" * 501
    unresolved = resolve_egress_reply(long_reply, ["待批查询"])
    assert not unresolved.declined
    assert unresolved.approved_queries == ()


def test_approval_payload_exposes_exact_query_and_options() -> None:
    payload = approval_payload("要发送的查询")
    clarification = payload["clarification"]
    assert "要发送的查询" in clarification["question"]
    labels = [option["label"] for option in clarification["options"]]
    assert labels == [APPROVE_OPTION_LABEL, DECLINE_OPTION_LABEL]
    assert clarification["allow_custom"] is True


def test_search_tool_blocks_unapproved_outgoing_query() -> None:
    tool = SearchPublicWebTool(client=object())
    context = ToolContext(
        platform_name="test",
        require_external_query_approval=True,
        approved_external_queries=("已批准查询",),
    )

    blocked = asyncio.run(tool.execute({"query": "未批准查询"}, context))
    assert blocked.status == "blocked"
    assert blocked.error is not None
    assert blocked.error.code == "external_query_not_approved"


def test_search_tool_accepts_approved_query_past_the_guard() -> None:
    class Client:
        provider = "tavily"

        async def search(self, request):
            raise AssertionError("已批准查询应越过审批门，进入网络调用")

    tool = SearchPublicWebTool(client=Client())
    context = ToolContext(
        platform_name="test",
        require_external_query_approval=True,
        approved_external_queries=("已批准查询",),
    )

    try:
        asyncio.run(tool.execute({"query": "已批准查询"}, context))
    except AssertionError as exc:
        assert "越过审批门" in str(exc)
    else:
        raise AssertionError("审批通过后应继续调用搜索客户端")

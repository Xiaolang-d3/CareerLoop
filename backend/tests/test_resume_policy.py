from __future__ import annotations

import unittest

from app.agent.resume_policy import (
    clarification_from_events,
    matches_clarification_option,
    resolve_resume_snapshot,
    should_abandon_snapshot,
)
from app.domain import (
    AgentClarification,
    AgentRunSnapshot,
    ClarificationOption,
    ToolEvent,
)


def _company_snapshot(**overrides: object) -> AgentRunSnapshot:
    payload = {
        "route_kind": "company_research",
        "needs_plan": True,
        "allowed_tools": ["research_company"],
        "clarification": AgentClarification(
            question="你指的是哪家公司？",
            options=[
                ClarificationOption(id="opt_1", label="字节跳动", send="按字节跳动继续"),
                ClarificationOption(id="opt_2", label="字节跳动教育", send="按字节跳动教育继续"),
            ],
        ),
        "rounds_used": 1,
    }
    payload.update(overrides)
    return AgentRunSnapshot.model_validate(payload)


class ResumePolicyTest(unittest.TestCase):
    def test_decision_table(self) -> None:
        snapshot = _company_snapshot()
        cases = [
            ("先别管公司，帮我改简历", True, "abandon phrase"),
            ("帮我改写简历", True, "tailored_resume lane"),
            ("帮我优化简历", True, "tailored_resume lane"),
            ("字节跳动", False, "option label"),
            ("按字节跳动继续", False, "option send"),
            ("  字节跳动  ", False, "option label with spaces"),
            ("美团", False, "short custom referent"),
            ("不是这两家是到店", False, "in-lane clarification"),
            ("算了我们聊聊要不要转产品", False, "v1 residual conversation"),
        ]
        for text, abandon, reason in cases:
            with self.subTest(text=text, reason=reason):
                self.assertEqual(should_abandon_snapshot(text, snapshot), abandon)

    def test_option_match_uses_first_line_when_attachments_appended(self) -> None:
        snapshot = _company_snapshot()
        text = "字节跳动\n\n以下为用户主动上传附件的本地解析文本"
        self.assertTrue(matches_clarification_option(text, snapshot))
        self.assertFalse(should_abandon_snapshot(text, snapshot))

    def test_option_substring_in_a_new_request_does_not_force_resume(self) -> None:
        snapshot = _company_snapshot()
        text = "不要字节跳动，帮我改写简历"
        self.assertFalse(matches_clarification_option(text, snapshot))
        self.assertTrue(should_abandon_snapshot(text, snapshot))

    def test_same_lane_follow_up_still_resumes(self) -> None:
        snapshot = _company_snapshot()
        self.assertFalse(should_abandon_snapshot("帮我调查一下这家公司怎么样", snapshot))

    def test_legacy_snapshot_without_clarification_still_abandons_on_phrase(self) -> None:
        snapshot = AgentRunSnapshot(
            route_kind="company_research",
            needs_plan=True,
            allowed_tools=["research_company"],
            rounds_used=1,
        )
        self.assertTrue(should_abandon_snapshot("先别管公司，帮我改简历", snapshot))
        self.assertFalse(should_abandon_snapshot("美团", snapshot))

    def test_resolve_resume_snapshot_clears_on_abandon(self) -> None:
        snapshot = _company_snapshot()
        self.assertIsNone(
            resolve_resume_snapshot("先别管公司，帮我改简历", snapshot)
        )
        self.assertIs(resolve_resume_snapshot("字节跳动", snapshot), snapshot)
        self.assertIsNone(resolve_resume_snapshot("美团", None))

    def test_clarification_from_events_reads_latest_payload(self) -> None:
        events = [
            ToolEvent(
                round=1,
                tool_call_id="ask-1",
                tool_name="ask_user",
                status="waiting_approval",
                message="旧问题",
                data={"clarification": {"question": "旧问题", "options": [{"label": "A"}, {"label": "B"}]}},
            ),
            ToolEvent(
                round=2,
                tool_call_id="ask-2",
                tool_name="ask_user",
                status="waiting_approval",
                message="你指的是哪家公司？",
                data={
                    "clarification": {
                        "question": "你指的是哪家公司？",
                        "options": [
                            {"id": "opt_1", "label": "字节跳动", "send": "按字节跳动继续"},
                            {"id": "opt_2", "label": "字节跳动教育", "send": "按字节跳动教育继续"},
                        ],
                    }
                },
            ),
        ]
        found = clarification_from_events(events)
        self.assertIsNotNone(found)
        self.assertEqual(found.question, "你指的是哪家公司？")
        self.assertEqual(found.options[0].send, "按字节跳动继续")


if __name__ == "__main__":
    unittest.main()

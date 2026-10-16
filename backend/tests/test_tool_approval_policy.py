from __future__ import annotations

import unittest

from app.agent.approval_policy import (
    APPROVE_OPTION_LABEL,
    DECLINE_OPTION_LABEL,
    ToolApprovalState,
    approval_payload,
    arguments_summary,
    resolve_approval_reply,
)
from app.domain import PendingToolApproval


class ArgumentsSummaryTest(unittest.TestCase):
    def test_renders_scalar_fields_and_scales_nested_values(self) -> None:
        summary = arguments_summary({
            "title": "周报",
            "count": 3,
            "draft": True,
            "tags": ["a", "b", "c"],
            "nested": {"secret": "x"},
        })

        self.assertIn("title=周报", summary)
        self.assertIn("count=3", summary)
        self.assertIn("draft=是", summary)
        self.assertIn("tags=共 3 项", summary)
        self.assertNotIn("secret", summary)

    def test_truncates_long_values(self) -> None:
        summary = arguments_summary({"draft": "x" * 400})

        self.assertLessEqual(len(summary), 500)
        self.assertTrue(summary.endswith("…"))

    def test_empty_arguments_render_empty_summary(self) -> None:
        self.assertEqual(arguments_summary({}), "")
        self.assertEqual(arguments_summary({"nested": {"a": 1}}), "")


class ApprovalPayloadTest(unittest.TestCase):
    def test_card_contains_title_summary_and_two_options(self) -> None:
        payload = approval_payload("保存到文件库", "title=周报")
        clarification = payload["clarification"]

        self.assertIn("保存到文件库", clarification["question"])
        self.assertIn("title=周报", clarification["question"])
        self.assertEqual(
            [option["label"] for option in clarification["options"]],
            [APPROVE_OPTION_LABEL, DECLINE_OPTION_LABEL],
        )
        self.assertTrue(clarification["allow_custom"])


class ResolveApprovalReplyTest(unittest.TestCase):
    def test_clicked_options_decide(self) -> None:
        self.assertTrue(resolve_approval_reply(APPROVE_OPTION_LABEL).approved)
        self.assertTrue(resolve_approval_reply(f"  {DECLINE_OPTION_LABEL}  ").declined)

    def test_other_text_keeps_the_call_held(self) -> None:
        for reply in ("", "  ", "换成明天", "继续"):
            with self.subTest(reply=reply):
                decision = resolve_approval_reply(reply)
                self.assertFalse(decision.approved)
                self.assertFalse(decision.declined)


class ToolApprovalStateTest(unittest.TestCase):
    def test_approve_is_fingerprint_bound_and_clears_pending(self) -> None:
        state = ToolApprovalState()
        pending = PendingToolApproval(tool_name="save_note", fingerprint="fp-1", title="保存笔记")
        state.hold(pending)

        self.assertFalse(state.allows("fp-1"))
        state.approve("fp-1")
        state.approve("fp-1")

        self.assertTrue(state.allows("fp-1"))
        self.assertFalse(state.allows("fp-2"))
        self.assertEqual(state.approved, ["fp-1"])
        self.assertIsNone(state.pending)

    def test_clear_pending_keeps_approvals(self) -> None:
        state = ToolApprovalState(approved=["fp-1"])
        state.hold(PendingToolApproval(tool_name="save_note", fingerprint="fp-2"))

        state.clear_pending()

        self.assertIsNone(state.pending)
        self.assertTrue(state.allows("fp-1"))


if __name__ == "__main__":
    unittest.main()

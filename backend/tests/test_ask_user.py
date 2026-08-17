from __future__ import annotations

import unittest

from app.tools.ask_user import AskUserTool
from app.tools.base import ToolContext


class AskUserToolTest(unittest.IsolatedAsyncioTestCase):
    async def test_returns_structured_clarification_and_pauses(self) -> None:
        result = await AskUserTool().execute(
            {
                "question": "你指的是哪家公司？",
                "options": [
                    {"label": "字节跳动"},
                    {"label": "字节跳动教育", "send": "按字节跳动教育继续"},
                ],
            },
            ToolContext(platform_name="manual", user_content="看看这家公司"),
        )

        self.assertEqual(result.status, "waiting_approval")
        self.assertEqual(result.error.code, "user_clarification_required")
        self.assertTrue(result.error.retryable)
        self.assertEqual(
            result.data["clarification"],
            {
                "question": "你指的是哪家公司？",
                "options": [
                    {"id": "opt_1", "label": "字节跳动", "send": "字节跳动"},
                    {"id": "opt_2", "label": "字节跳动教育", "send": "按字节跳动教育继续"},
                ],
                "allow_custom": True,
            },
        )

    async def test_rejects_duplicate_or_too_few_options(self) -> None:
        result = await AskUserTool().execute(
            {
                "question": "选一个",
                "options": [{"label": "只要这个"}, {"label": "只要这个"}],
            },
            ToolContext(platform_name="manual"),
        )

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error.code, "invalid_arguments")

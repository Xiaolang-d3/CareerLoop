from __future__ import annotations

import unittest

from app.resume.blocks import parse_resume_blocks, stable_block_id, title_score


class ResumeBlockTest(unittest.TestCase):
    def test_project_and_work_get_stable_ids(self) -> None:
        text = """
求职方向：AI 应用工程师
工作经历
89Trillion｜AI 应用工程师｜2025.07 - 至今
负责服务稳定性与线上排障。
项目经历
智能会议总结（Summary）
- 基于 LangChain 搭建统一 LLM 接入网关。
技能：Python、FastAPI
"""
        first = parse_resume_blocks(text)
        second = parse_resume_blocks(text)
        kinds = {item.kind: item for item in first}
        self.assertIn("project", kinds)
        self.assertIn("work", kinds)
        self.assertEqual(kinds["project"].title, "智能会议总结（Summary）")
        self.assertIn("89Trillion", kinds["work"].evidence)
        self.assertEqual([item.id for item in first], [item.id for item in second])
        self.assertTrue(kinds["project"].id.startswith("project-"))
        self.assertEqual(
            kinds["project"].id,
            stable_block_id("project", kinds["project"].title, kinds["project"].start_date, kinds["project"].evidence),
        )

    def test_title_score_prefers_dated_headings_over_bullets(self) -> None:
        self.assertGreater(
            title_score("智能求职项目 2024.03-2025.01", "work"),
            title_score("- 使用 FastAPI 开发检索模块", "work"),
        )

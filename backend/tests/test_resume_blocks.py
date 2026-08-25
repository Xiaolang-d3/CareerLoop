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

    def test_combined_work_internship_heading_is_recognized(self) -> None:
        text = """
个人优势
「能力」：熟悉 LangChain。
工作与实习经历
星河科技｜AI 应用工程师 2025.07 - 2026.04
- 负责智能会议总结与多模态分析。
教育经历
示例大学 软件工程 2021.09-2025.06
"""
        blocks = parse_resume_blocks(text)
        kinds = {block.kind: block for block in blocks}
        self.assertIn("work", kinds)
        self.assertIn("星河科技", kinds["work"].evidence)
        self.assertIn("教育经历", kinds["education"].section)

    def test_nested_projects_inside_work_section_split_into_project_blocks(self) -> None:
        text = """
工作与实习经历
星河科技｜AI 应用工程师 2025.07 - 2026.04
智能会议总结（Summary）
- 基于 LangChain 搭建统一 LLM 接入网关。
多端 AI 内容分析平台（TrueOrFalse）
- 搭建文本、图片、音频多模态分析链路。
"""
        blocks = parse_resume_blocks(text)
        works = [block for block in blocks if block.kind == "work"]
        projects = [block for block in blocks if block.kind == "project"]
        self.assertEqual(len(works), 1)
        self.assertIn("星河科技", works[0].title)
        self.assertNotIn("智能会议总结", works[0].evidence)
        self.assertEqual(
            [block.title for block in projects],
            ["智能会议总结（Summary）", "多端 AI 内容分析平台（TrueOrFalse）"],
        )
        self.assertIn("统一 LLM 接入网关", projects[0].evidence)
        self.assertIn("多模态分析链路", projects[1].evidence)

    def test_jammed_work_project_and_url_line_splits_before_next_job(self) -> None:
        text = """
工作与项目经历
星河科技（北京星河科技有限公司）-AI 应用开发工程师 2025.07 - 2026.04 智能会议总结（Summary） https://example.com/apps/summary
- 负责统一 LLM 接入与调用编排层设计。
智能内容分析平台(True or False) https://example.com/apps/analysis
- 构建文本、图片、音频多模态统一分析链路。
云端科技-测试开发工程师 2025.03 - 2025.05
- 负责鸿蒙应用兼容性比对测试。
"""
        blocks = parse_resume_blocks(text)
        works = [block for block in blocks if block.kind == "work"]
        projects = [block for block in blocks if block.kind == "project"]

        self.assertEqual([block.title for block in works], [
            "星河科技（北京星河科技有限公司）-AI 应用开发工程师 2025.07 - 2026.04",
            "云端科技-测试开发工程师 2025.03 - 2025.05",
        ])
        self.assertEqual([block.title for block in projects], [
            "智能会议总结（Summary） https://example.com/apps/summary",
            "智能内容分析平台(True or False) https://example.com/apps/analysis",
        ])
        self.assertNotIn("云端科技", projects[-1].evidence)

    def test_numbered_headings_still_match(self) -> None:
        text = """
三、工作与实习经历
星河科技｜AI 应用工程师 2025.07 - 2026.04
- 负责智能会议总结。
"""
        blocks = parse_resume_blocks(text)
        works = [block for block in blocks if block.kind == "work"]
        self.assertEqual(len(works), 1)
        self.assertIn("星河科技", works[0].title)

    def test_pdf_wrapped_bullet_lines_merge_into_one_block(self) -> None:
        text = """
工作经历
星河科技｜AI 应用工程师 2025.07 - 2026.04
- 打通内容提交、分布式任务调度、多模型并发调用、结果解析、数据落库全链路，设计优先级调度策略，高峰任
务排队超时率降低 60%，系统整体吞吐量提升 1.8 倍。
"""
        blocks = parse_resume_blocks(text)
        works = [block for block in blocks if block.kind == "work"]
        self.assertEqual(len(works), 1)
        self.assertIn("高峰任务排队超时率降低 60%", works[0].evidence)
        self.assertFalse(
            any(block.title.startswith("务排队") for block in blocks),
            "跨行断句不应产生独立伪块",
        )

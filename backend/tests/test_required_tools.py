from __future__ import annotations

import unittest

from app.agent.orchestration import (
    REQUIRED_BY_ROUTE,
    TOOL_POLICIES,
    build_task_route,
    parse_plan,
    required_tools_for_route,
)
from app.domain import ModelResponse


LANE_PROBES = {
    "company_research": "了解一下公司背景",
    "web_search": "联网搜索最新消息",
    "job_due_diligence": "分析这个岗位并调查公司背景",
    "profile_analysis": "帮我分析一下我的优势",
    "project_story": "帮我梳理项目亮点",
    "tailored_resume": "定制一份高匹配简历",
    "interview_preparation": "帮我做面试准备",
    "career_package": "定制一份简历并准备面试",
    "interview_debrief": "帮我复盘刚才的面试",
    "profile_onboarding": "开始了解我",
    "profile_enrichment": "补充画像",
}


class RequiredToolsTest(unittest.TestCase):
    def test_required_aliases_intersect_allowed_tools(self) -> None:
        available = set(TOOL_POLICIES)
        self.assertEqual(set(LANE_PROBES), set(REQUIRED_BY_ROUTE))
        for kind, alias_groups in REQUIRED_BY_ROUTE.items():
            route = build_task_route(kind, LANE_PROBES[kind], available)
            self.assertTrue(route.needs_plan, kind)
            required = required_tools_for_route(route)
            self.assertTrue(required, kind)
            for aliases in alias_groups:
                self.assertTrue(
                    set(aliases) & set(route.allowed_tools),
                    (kind, aliases, route.allowed_tools),
                )

    def test_parse_plan_injects_preferred_resume_tool(self) -> None:
        route = build_task_route("tailored_resume", "定制一份简历", set(TOOL_POLICIES))
        plan = parse_plan(
            ModelResponse(content='{"goal":"写简历","steps":[]}'),
            "定制一份简历",
            route,
        )
        self.assertIn("generate_tailored_resume_content", [step.tool_name for step in plan.steps])
        self.assertNotIn("generate_candidate_material", [step.tool_name for step in plan.steps])


if __name__ == "__main__":
    unittest.main()

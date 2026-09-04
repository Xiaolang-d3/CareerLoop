from __future__ import annotations

import unittest

from app.agent.orchestration import (
    JOB_SCREENSHOT_MARKER,
    ROUTE_LABELS,
    TOOL_POLICIES,
    WEB_SEARCH_MARKER,
    apply_hard_gates,
    build_task_route,
    classifier_prompt,
    detect_kind,
    parse_plan,
    parse_classified_kind,
    refine_route_from_classifier,
    route_task,
    should_classify_kind,
    strip_routing_markers,
    tools_for_kind,
)
from app.domain import ModelResponse, ToolCall
from app.tooling import ToolSpec


AVAILABLE = set(TOOL_POLICIES)


class RouteCompilerTest(unittest.TestCase):
    def test_detect_kind_does_not_select_tools(self) -> None:
        self.assertEqual(detect_kind("分析这个岗位是否适合我"), "jd_analysis")
        self.assertEqual(detect_kind("帮我调查一下示例科技这家公司怎么样"), "company_research")
        self.assertEqual(detect_kind("帮我在 BOSS 搜索几个岗位"), "conversation")
        self.assertEqual(detect_kind("这家靠谱吗"), "conversation")

    def test_tools_follow_kind_not_content_keywords(self) -> None:
        tools = tools_for_kind(
            "company_research",
            "分析这个岗位是否适合我",
            {"research_company", "analyze_resume_against_jd", "search_resume_evidence"},
        )
        self.assertEqual(tools, ("research_company",))

    def test_capability_metadata_can_supply_a_new_tool_without_route_name_changes(self) -> None:
        replacement = ToolSpec(
            name="generic_entity_research",
            title="通用实体研究",
            risk="external_read",
            capabilities=frozenset({"company.research"}),
            priority=5,
        )

        route = build_task_route(
            "company_research",
            "调查这家公司",
            {replacement.name},
            tool_specs={replacement.name: replacement},
        )

        self.assertEqual(route.allowed_tools, ("generic_entity_research",))
        self.assertEqual(route.required_tools, ("generic_entity_research",))
        plan = parse_plan(
            ModelResponse(content="not-json"),
            "调查这家公司",
            route,
            {replacement.name: replacement},
        )
        self.assertEqual([step.tool_name for step in plan.steps], [replacement.name])

    def test_screenshot_marker_is_stripped_then_hard_gated(self) -> None:
        raw = f"帮我看看\n{JOB_SCREENSHOT_MARKER}"
        self.assertEqual(strip_routing_markers(raw), "帮我看看")
        self.assertEqual(detect_kind(raw), "conversation")
        self.assertEqual(apply_hard_gates(raw, detect_kind(raw)), "jd_analysis")
        route = route_task(raw, {"analyze_resume_against_jd", "search_resume_evidence"})
        self.assertEqual(route.kind, "jd_analysis")
        self.assertEqual(set(route.allowed_tools), {"analyze_resume_against_jd", "search_resume_evidence"})

    def test_web_search_marker_beats_jd_analysis_but_not_job_evaluation(self) -> None:
        jd = f"分析这个岗位是否适合我\n{WEB_SEARCH_MARKER}"
        self.assertEqual(apply_hard_gates(jd, detect_kind(jd)), "web_search")
        evaluation = f"为已保存的岗位生成完整评估和岗位决策报告\n{WEB_SEARCH_MARKER}"
        self.assertEqual(detect_kind(evaluation), "job_evaluation")
        self.assertEqual(apply_hard_gates(evaluation, detect_kind(evaluation)), "job_evaluation")

    def test_web_search_marker_with_company_signals_stays_company_research(self) -> None:
        raw = f"最近有什么公司新闻？\n{WEB_SEARCH_MARKER}"
        self.assertEqual(apply_hard_gates(raw, detect_kind(raw)), "company_research")

    def test_active_interview_is_a_hard_rule_not_a_keyword(self) -> None:
        route = route_task("AI 产品经理，上海", AVAILABLE, profile_interview_active=True)
        self.assertEqual(route.kind, "profile_enrichment")
        self.assertEqual(
            set(route.allowed_tools),
            {
                "record_profile_interview_answer",
                "pause_profile_interview",
                "start_profile_interview",
            },
        )
        self.assertFalse(should_classify_kind(route, "AI 产品经理，上海"))

    def test_should_classify_only_open_conversation(self) -> None:
        miss = route_task("这家靠谱吗", AVAILABLE)
        hit = route_task("分析这个岗位是否适合我", AVAILABLE)
        self.assertTrue(should_classify_kind(miss, "这家靠谱吗"))
        self.assertFalse(should_classify_kind(hit, "分析这个岗位是否适合我"))
        self.assertFalse(should_classify_kind(miss, f"\n{WEB_SEARCH_MARKER}"))

    def test_simple_greetings_do_not_spend_an_extra_classifier_call(self) -> None:
        for content in ("hello", "Hello!", "你好", "你好。", "test"):
            route = route_task(content, AVAILABLE)
            self.assertEqual(route.kind, "conversation")
            self.assertFalse(should_classify_kind(route, content))

    def test_classifier_prompt_lists_kinds_not_tools(self) -> None:
        prompt = classifier_prompt("这家靠谱吗")
        for kind in ROUTE_LABELS:
            self.assertIn(kind, prompt)
        for tool_name in TOOL_POLICIES:
            self.assertNotIn(tool_name, prompt)

    def test_parse_classified_kind_accepts_only_route_labels(self) -> None:
        self.assertEqual(
            parse_classified_kind(ModelResponse(content='{"kind":"company_research"}')),
            "company_research",
        )
        self.assertEqual(
            parse_classified_kind(ModelResponse(content='```json\n{"kind":"jd_analysis"}\n```')),
            "jd_analysis",
        )
        self.assertIsNone(parse_classified_kind(ModelResponse(content='{"kind":"research_company"}')))
        self.assertIsNone(parse_classified_kind(ModelResponse(content='{"kind":"unknown_lane"}')))
        self.assertEqual(
            parse_classified_kind(
                ModelResponse(content='{"kind":"conversation","tool_name":"research_company"}')
            ),
            "conversation",
        )
        self.assertIsNone(
            parse_classified_kind(
                ModelResponse(
                    content='{"kind":"company_research"}',
                    tool_calls=[ToolCall(id="t1", name="research_company", arguments={})],
                )
            )
        )

    def test_ask_user_is_never_part_of_lane_tools(self) -> None:
        for kind in ROUTE_LABELS:
            self.assertNotIn("ask_user", tools_for_kind(kind, "帮我看看", AVAILABLE))
        self.assertEqual(route_task("帮我看看这家公司", AVAILABLE).allowed_tools, ())

    def test_classified_kind_cannot_invent_tools(self) -> None:
        route = build_task_route("company_research", "这家靠谱吗", AVAILABLE)
        self.assertEqual(route.allowed_tools, ("research_company",))
        unknown = build_task_route("not_a_lane", "这家靠谱吗", AVAILABLE)
        self.assertEqual(unknown.kind, "conversation")
        self.assertEqual(unknown.allowed_tools, ())

    def test_refine_route_uses_kind_then_policy_tools(self) -> None:
        miss = route_task("这家靠谱吗", AVAILABLE)
        refined = refine_route_from_classifier(
            miss,
            "这家靠谱吗",
            AVAILABLE,
            ModelResponse(content='{"kind":"company_research"}'),
        )
        self.assertEqual(refined.kind, "company_research")
        self.assertEqual(refined.allowed_tools, ("research_company",))

        ignored = refine_route_from_classifier(
            miss,
            "这家靠谱吗",
            AVAILABLE,
            ModelResponse(content='{"kind":"research_company"}'),
        )
        self.assertEqual(ignored.kind, "conversation")
        self.assertEqual(ignored.allowed_tools, ())

        skipped = refine_route_from_classifier(
            route_task("分析这个岗位是否适合我", AVAILABLE),
            "分析这个岗位是否适合我",
            AVAILABLE,
            ModelResponse(content='{"kind":"company_research"}'),
        )
        self.assertEqual(skipped.kind, "jd_analysis")


if __name__ == "__main__":
    unittest.main()

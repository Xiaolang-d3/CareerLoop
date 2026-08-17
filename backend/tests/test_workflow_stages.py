from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app import db
from app.agent.orchestration import ROUTE_LABELS, TOOL_POLICIES
from app.chat.conversations import create_conversation, ensure_active_task
from app.agent.snapshots import load_run_snapshot
from app.domain import AgentPlan, AgentPlanStep, AgentRunResult, AgentRunSnapshot, ToolEvent
from app.chat.service import save_stream_result, workflow_summary
from app.workflow.engine import record_stage_activity, refresh_workflow_status
from app.workflow.stages import (
    LEGACY_COUNT_KEYS,
    ROUTE_STAGES,
    STAGE_DEFS,
    STAGE_IDS,
    TOOL_STAGES,
)


class StageDefinitionTest(unittest.TestCase):
    """守护阶段映射与 orchestration 的一致性：加了 route/工具却忘配阶段时必须失败。"""

    def test_route_stages_cover_every_route_label(self) -> None:
        self.assertEqual(set(ROUTE_STAGES), set(ROUTE_LABELS))

    def test_tool_stages_cover_every_registered_tool_policy(self) -> None:
        self.assertEqual(set(TOOL_STAGES), set(TOOL_POLICIES))

    def test_all_mapped_stages_exist_in_stage_defs(self) -> None:
        for kind, stage_id in ROUTE_STAGES.items():
            if stage_id is not None:
                self.assertIn(stage_id, STAGE_IDS, f"route {kind} 指向未知阶段 {stage_id}")
        for tool_name, stage_id in TOOL_STAGES.items():
            if stage_id is not None:
                self.assertIn(stage_id, STAGE_IDS, f"工具 {tool_name} 指向未知阶段 {stage_id}")

    def test_legacy_count_keys_reference_real_stages(self) -> None:
        for legacy_key, stage_id in LEGACY_COUNT_KEYS.items():
            self.assertIn(stage_id, STAGE_IDS, f"旧计数键 {legacy_key} 指向未知阶段 {stage_id}")

    def test_stage_ids_are_unique(self) -> None:
        ids = [stage_id for stage_id, _, _ in STAGE_DEFS]
        self.assertEqual(len(ids), len(set(ids)))


def _thinking_event(route: str) -> ToolEvent:
    return ToolEvent(
        round=0,
        tool_call_id="agent-thinking",
        tool_name="agent_thinking",
        status="done",
        message="路由完成",
        data={"route": route, "allowed_tools": []},
    )


def _tool_event(tool_name: str, status: str = "done") -> ToolEvent:
    return ToolEvent(
        round=1,
        tool_call_id=f"call-{tool_name}",
        tool_name=tool_name,
        status=status,
        message=f"{tool_name} 完成",
        data={},
    )


class StageProgressTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = db.DB_PATH
        db.DB_PATH = Path(self.temp_dir.name) / "stages.db"
        db.init_db()
        self.conversation_id = create_conversation("阶段测试")["id"]
        self.task_id = ensure_active_task(self.conversation_id)

    def tearDown(self) -> None:
        db.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def _save(self, result: AgentRunResult) -> dict:
        return save_stream_result(
            self.conversation_id,
            self.task_id,
            {"id": 0, "role": "user", "content": "测试"},
            result,
        )["workflow"]

    def _node(self, workflow: dict, stage_id: str) -> dict:
        for node in workflow["nodes"]:
            if node["id"] == stage_id:
                return node
        raise AssertionError(f"未找到阶段节点 {stage_id}")

    def test_career_os_tool_advances_its_stage(self) -> None:
        """回归：CareerOS 工具此前不写 workflow_event，阶段永远 pending。"""
        workflow = self._save(
            AgentRunResult(
                content="已生成岗位决策报告",
                provider="test",
                platform="manual",
                rounds=1,
                events=[
                    _thinking_event("job_evaluation"),
                    _tool_event("create_job_evaluation"),
                ],
            )
        )
        self.assertEqual(self._node(workflow, "job_evaluation")["status"], "running")
        self.assertIn("触达", self._node(workflow, "job_evaluation")["detail"])
        self.assertEqual(workflow["stage_counts"]["job_evaluation"], 1)

    def test_every_career_os_tool_is_recorded(self) -> None:
        """逐个验证当前 CareerOS 工具都能推进阶段，而非依赖固定数量。"""
        career_os_tools = [
            name
            for name, stage_id in TOOL_STAGES.items()
            if stage_id is not None
            and name
            not in {
                "analyze_resume_against_jd",
                "search_resume_evidence",
                "generate_tailored_resume_content",
                "generate_interview_advice",
                "research_company",
                "search_public_web",
            }
        ]
        self.assertTrue(career_os_tools)
        workflow = self._save(
            AgentRunResult(
                content="批量",
                provider="test",
                platform="manual",
                rounds=1,
                events=[_thinking_event("conversation")]
                + [_tool_event(name) for name in career_os_tools],
            )
        )
        recorded = sum(workflow["stage_counts"].values())
        self.assertEqual(recorded, len(career_os_tools))

    def test_legacy_tool_still_advances_its_stage(self) -> None:
        workflow = self._save(
            AgentRunResult(
                content="已分析",
                provider="test",
                platform="manual",
                rounds=1,
                events=[
                    _thinking_event("jd_analysis"),
                    _tool_event("analyze_resume_against_jd"),
                ],
            )
        )
        self.assertEqual(self._node(workflow, "job_evaluation")["status"], "running")

    def test_local_answer_route_marks_stage_running_without_tools(self) -> None:
        """本地快捷回复只有 agent_thinking 事件，仍应让主阶段离开 pending。"""
        workflow = self._save(
            AgentRunResult(
                content="已记录",
                provider="local_router",
                platform="manual",
                rounds=0,
                events=[_thinking_event("profile_enrichment")],
            )
        )
        self.assertEqual(self._node(workflow, "candidate_knowledge")["status"], "running")
        self.assertEqual(workflow["stage_counts"]["candidate_knowledge"], 0)

    def test_synthetic_and_failed_events_are_ignored(self) -> None:
        workflow = self._save(
            AgentRunResult(
                content="失败",
                provider="test",
                platform="manual",
                rounds=1,
                events=[
                    _thinking_event("conversation"),
                    _tool_event("agent_planner"),
                    _tool_event("model_provider"),
                    _tool_event("citation_validator"),
                    _tool_event("create_job_evaluation", status="failed"),
                ],
            )
        )
        self.assertEqual(sum(workflow["stage_counts"].values()), 0)
        for node in workflow["nodes"]:
            self.assertEqual(node["status"], "pending")

    def test_unknown_route_does_not_crash(self) -> None:
        """main.py 的本地路由会用 workflow_status 这类不在 ROUTE_LABELS 的值。"""
        workflow = self._save(
            AgentRunResult(
                content="进度",
                provider="local_router",
                platform="manual",
                rounds=0,
                events=[_thinking_event("workflow_status")],
            )
        )
        self.assertEqual(sum(workflow["stage_counts"].values()), 0)

    def test_plan_route_used_when_thinking_event_absent(self) -> None:
        workflow = self._save(
            AgentRunResult(
                content="已规划",
                provider="test",
                platform="manual",
                rounds=1,
                events=[_tool_event("create_job_evaluation")],
                plan=AgentPlan(
                    goal="评估岗位",
                    route="job_evaluation",
                    steps=[
                        AgentPlanStep(
                            id="s1",
                            title="生成评估",
                            tool_name="create_job_evaluation",
                            risk="external_read",
                        )
                    ],
                ),
            )
        )
        self.assertEqual(self._node(workflow, "job_evaluation")["status"], "running")

    def test_response_keeps_legacy_count_keys(self) -> None:
        """前端与 e2e mock 仍读旧键，后端改动不应破坏它们。"""
        workflow = refresh_workflow_status(self.conversation_id)
        for legacy_key in LEGACY_COUNT_KEYS:
            self.assertIn(legacy_key, workflow["counts"])
        self.assertIn("profiles", workflow["counts"])

    def test_nodes_expose_ordered_stages_with_hints(self) -> None:
        workflow = refresh_workflow_status(self.conversation_id)
        self.assertEqual(
            [node["id"] for node in workflow["nodes"]],
            [stage_id for stage_id, _, _ in STAGE_DEFS],
        )
        for node in workflow["nodes"]:
            self.assertTrue(node["hint"])
            self.assertEqual(node["status"], "pending")

    def test_run_stays_in_progress_after_all_stages_are_touched(self) -> None:
        partial = self._save(
            AgentRunResult(
                content="部分",
                provider="test",
                platform="manual",
                rounds=1,
                events=[_thinking_event("job_evaluation"), _tool_event("create_job_evaluation")],
            )
        )
        self.assertEqual(partial["status"], "in_progress")

        tool_events = []
        for stage_id, _, _ in STAGE_DEFS:
            tool_name = next((name for name, mapped in TOOL_STAGES.items() if mapped == stage_id), None)
            if tool_name:
                tool_events.append(_tool_event(tool_name))
        self._save(
            AgentRunResult(
                content="全部",
                provider="test",
                platform="manual",
                rounds=1,
                events=[_thinking_event("conversation"), *tool_events],
            )
        )
        for stage_id, _, _ in STAGE_DEFS:
            if not any(mapped == stage_id for mapped in TOOL_STAGES.values()):
                record_stage_activity(stage_id, "stage_engaged", "工作台已触达该阶段")
        workflow = refresh_workflow_status(self.conversation_id)
        self.assertEqual(workflow["status"], "in_progress")
        for node in workflow["nodes"]:
            self.assertEqual(node["status"], "running")
            self.assertIn("触达", node["detail"])

    def test_workbench_activity_touches_the_workspace_ledger(self) -> None:
        from app.workflow.engine import record_stage_activity, refresh_workflow_status

        record_stage_activity("job_evaluation", "stage_engaged", "工作台已创建岗位评估")
        workflow = refresh_workflow_status(self.conversation_id)
        node = self._node(workflow, "job_evaluation")
        self.assertEqual(node["status"], "running")
        self.assertIn("触达", node["detail"])

    def test_workflow_summary_uses_touch_language(self) -> None:
        empty = refresh_workflow_status(self.conversation_id)
        self.assertIn("尚未触达", workflow_summary(empty))
        self.assertNotIn("节点完成", workflow_summary(empty))
        touched = self._save(
            AgentRunResult(
                content="已分析",
                provider="test",
                platform="manual",
                rounds=1,
                events=[_thinking_event("jd_analysis"), _tool_event("analyze_resume_against_jd")],
            )
        )
        summary = workflow_summary(touched)
        self.assertIn("已触达", summary)
        self.assertNotIn("节点完成", summary)

    def test_waiting_snapshot_is_saved_and_cleared(self) -> None:
        waiting = AgentRunResult(
            content="需要确认",
            provider="test",
            platform="manual",
            rounds=1,
            status="waiting_user",
            events=[_thinking_event("conversation")],
            snapshot=AgentRunSnapshot(
                route_kind="conversation",
                needs_plan=False,
                allowed_tools=[],
                messages=[],
                rounds_used=1,
            ),
        )
        save_stream_result(
            self.conversation_id,
            self.task_id,
            {"id": 0, "role": "user", "content": "测试"},
            waiting,
        )
        loaded = load_run_snapshot(self.conversation_id)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.route_kind, "conversation")

        save_stream_result(
            self.conversation_id,
            self.task_id,
            {"id": 0, "role": "user", "content": "进度"},
            AgentRunResult(
                content="进度",
                provider="local_router",
                platform="manual",
                rounds=0,
                events=[_thinking_event("workflow_status")],
            ),
        )
        self.assertIsNotNone(load_run_snapshot(self.conversation_id))

        save_stream_result(
            self.conversation_id,
            self.task_id,
            {"id": 0, "role": "user", "content": "完成"},
            AgentRunResult(
                content="完成",
                provider="test",
                platform="manual",
                rounds=1,
                events=[_thinking_event("conversation")],
            ),
        )
        self.assertIsNone(load_run_snapshot(self.conversation_id))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.agent.run_store import AgentRunStore
from app.db import connect, init_db
from app.domain import (
    AgentPlan,
    AgentPlanStep,
    AgentRunResult,
    AgentRunSnapshot,
    ToolCall,
    ToolResult,
)
from app.tooling import ToolSpec


class AgentRunStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "agent-runs.db"
        init_db(self.db_path)
        with connect(self.db_path) as conn:
            self.conversation_id = conn.execute(
                "INSERT INTO conversations (title) VALUES ('持久化测试')"
            ).lastrowid
            self.task_id = conn.execute(
                "INSERT INTO conversation_tasks (conversation_id) VALUES (?)",
                (self.conversation_id,),
            ).lastrowid
        self.store = AgentRunStore(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_run_lifecycle_persists_checkpoint_and_terminal_result(self) -> None:
        started = self.store.start_run(
            "run-1",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="研究公司",
        )
        self.assertEqual(started["status"], "running")

        snapshot = AgentRunSnapshot(
            route_kind="company_research",
            needs_plan=True,
            allowed_tools=["research_company"],
            rounds_used=2,
            plan=AgentPlan(
                goal="研究公司",
                route="company_research",
                steps=[AgentPlanStep(
                    id="step-1",
                    title="检索资料",
                    tool_name="research_company",
                    risk="external_read",
                )],
            ),
        )
        self.store.checkpoint("run-1", snapshot)

        loaded = self.store.get_run("run-1")
        self.assertEqual(loaded["route_kind"], "company_research")
        self.assertEqual(loaded["round_number"], 2)
        self.assertEqual(loaded["checkpoint"].allowed_tools, ["research_company"])
        self.assertEqual(self.store.list_steps("run-1")[0]["status"], "pending")

        snapshot.plan.steps[0].status = "done"
        self.store.checkpoint("run-1", snapshot)
        self.assertEqual(self.store.list_steps("run-1")[0]["status"], "done")

        result = AgentRunResult(
            content="完成",
            provider="test",
            platform="manual",
            rounds=3,
            status="done",
        )
        self.store.finish("run-1", result)

        finished = self.store.get_run("run-1")
        self.assertEqual(finished["status"], "completed")
        self.assertEqual(finished["stop_reason"], "completed")
        self.assertEqual(finished["result"].content, "完成")

    def test_start_is_idempotent_and_does_not_replace_terminal_result(self) -> None:
        self.store.start_run(
            "run-stable",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="原始请求",
        )
        self.store.finish(
            "run-stable",
            AgentRunResult(
                content="原始结果",
                provider="test",
                platform="manual",
                rounds=1,
            ),
        )

        replay = self.store.start_run(
            "run-stable",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="重复请求",
        )

        self.assertEqual(replay["status"], "completed")
        self.assertEqual(replay["user_content"], "原始请求")
        self.assertEqual(replay["result"].content, "原始结果")

    def test_run_id_cannot_move_between_conversations(self) -> None:
        self.store.start_run(
            "scoped-run",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="原始请求",
        )
        with connect(self.db_path) as conn:
            other_conversation = conn.execute(
                "INSERT INTO conversations (title) VALUES ('其他对话')"
            ).lastrowid

        with self.assertRaisesRegex(ValueError, "其他对话"):
            self.store.start_run(
                "scoped-run",
                conversation_id=other_conversation,
                task_id=None,
                user_content="冲突请求",
            )

    def test_startup_marks_running_run_and_tool_interrupted(self) -> None:
        self.store.start_run(
            "run-crash",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="写入资料",
        )
        write_spec = ToolSpec(
            name="write_fact",
            title="写入资料",
            risk="local_pending_write",
            capabilities=frozenset({"candidate.write"}),
        )
        decision = self.store.prepare_tool_call(
            "run-crash",
            "write-fingerprint",
            ToolCall(id="write-1", name="write_fact", arguments={"value": "A"}),
            write_spec,
        )
        self.assertEqual(decision.action, "execute")

        self.assertEqual(self.store.interrupt_active_runs(), 1)

        interrupted = self.store.get_run("run-crash")
        self.assertEqual(interrupted["status"], "interrupted")
        blocked = self.store.prepare_tool_call(
            "run-crash",
            "write-fingerprint",
            ToolCall(id="write-2", name="write_fact", arguments={"value": "A"}),
            write_spec,
        )
        self.assertEqual(blocked.action, "block")
        self.assertEqual(blocked.result.error.code, "tool_execution_uncertain")

    def test_interrupted_read_tool_can_execute_again(self) -> None:
        self.store.start_run(
            "run-read",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="读取资料",
        )
        read_spec = ToolSpec(
            name="read_context",
            title="读取资料",
            risk="read_only",
            capabilities=frozenset({"candidate.read"}),
        )
        call = ToolCall(id="read-1", name="read_context", arguments={})
        self.assertEqual(
            self.store.prepare_tool_call("run-read", "read-fingerprint", call, read_spec).action,
            "execute",
        )
        self.store.interrupt_active_runs()

        retry = self.store.prepare_tool_call(
            "run-read",
            "read-fingerprint",
            ToolCall(id="read-2", name="read_context", arguments={}),
            read_spec,
        )

        self.assertEqual(retry.action, "execute")
        with connect(self.db_path) as conn:
            attempts = conn.execute(
                "SELECT attempt_count FROM agent_tool_executions WHERE run_id = 'run-read'"
            ).fetchone()["attempt_count"]
        self.assertEqual(attempts, 2)

    def test_completed_tool_result_is_replayed(self) -> None:
        self.store.start_run(
            "run-replay",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="读取资料",
        )
        spec = ToolSpec(
            name="read_context",
            title="读取资料",
            risk="read_only",
            capabilities=frozenset({"candidate.read"}),
        )
        call = ToolCall(id="read-1", name="read_context", arguments={"scope": "match"})
        self.store.prepare_tool_call("run-replay", "same-call", call, spec)
        self.store.record_tool_result(
            "run-replay",
            "same-call",
            ToolResult(ok=True, status="done", data={"name": "候选人"}, message="读取完成"),
        )

        replay = self.store.prepare_tool_call(
            "run-replay",
            "same-call",
            ToolCall(id="read-2", name="read_context", arguments={"scope": "match"}),
            spec,
        )

        self.assertEqual(replay.action, "replay")
        self.assertTrue(replay.result.data["idempotent_replay"])
        self.assertEqual(replay.result.data["name"], "候选人")

    def test_cancel_request_is_durable(self) -> None:
        self.store.start_run(
            "run-cancel",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="长任务",
        )

        self.assertTrue(self.store.request_cancel_for_conversation(self.conversation_id))
        self.assertTrue(self.store.is_cancel_requested("run-cancel"))

    def test_waiting_run_links_to_the_run_that_resumes_it(self) -> None:
        self.store.start_run(
            "waiting-parent",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="需要确认",
        )
        self.store.finish(
            "waiting-parent",
            AgentRunResult(
                content="请选择",
                provider="test",
                platform="manual",
                rounds=1,
                status="waiting_user",
                snapshot=AgentRunSnapshot(
                    route_kind="company_research",
                    needs_plan=True,
                ),
            ),
        )
        self.store.start_run(
            "resume-child",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="继续",
        )

        parent = self.store.link_waiting_resume(
            self.conversation_id,
            "resume-child",
        )

        self.assertEqual(parent, "waiting-parent")
        self.assertEqual(
            self.store.get_run("waiting-parent")["resumed_by_run_id"],
            "resume-child",
        )
        self.assertEqual(
            self.store.get_run("resume-child")["parent_run_id"],
            "waiting-parent",
        )


if __name__ == "__main__":
    unittest.main()

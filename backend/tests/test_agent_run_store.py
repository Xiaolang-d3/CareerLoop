from __future__ import annotations

import tempfile
import threading
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from app.agent.run_store import AgentRunStore
from app.agent.snapshots import load_run_snapshot, save_run_snapshot
from app.db import connect, init_db
from app.domain import (
    AgentPlan,
    AgentPlanStep,
    AgentRunResult,
    AgentRunSnapshot,
    AgentMessage,
    ToolCall,
    ToolResult,
)
from app.tooling import ToolSpec
from app.search_options import WebSearchOptions


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

    def test_search_binding_survives_early_crash_checkpoint_and_terminal_replay(self) -> None:
        options = WebSearchOptions(enabled=True, topic="news", provider="tavily")
        run = self.store.start_run("search-binding", conversation_id=self.conversation_id,
                                   task_id=self.task_id, user_content="AI动态", web_search_options=options)
        self.assertEqual(run["web_search_options"], options)
        self.assertIsNone(run["checkpoint"])
        self.assertFalse(run["checkpoint_invalid"])
        self.store.interrupt_active_runs()
        changed = self.store.start_run("search-binding", conversation_id=self.conversation_id,
                                       task_id=self.task_id, user_content="覆盖请求", web_search_options=WebSearchOptions())
        self.assertEqual(changed["web_search_options"], options)
        self.store.checkpoint("search-binding", AgentRunSnapshot(route_kind="web_search", needs_plan=False,
                               web_search_options=WebSearchOptions(enabled=True, topic="finance")))
        self.assertEqual(self.store.get_run("search-binding")["checkpoint"].web_search_options, options)
        self.store.finish("search-binding", AgentRunResult(content="完成", provider="test", platform="manual", rounds=1))
        self.assertEqual(self.store.get_run("search-binding")["web_search_options"], options)

    def test_legacy_run_backfills_only_from_bound_user_message(self) -> None:
        with connect(self.db_path) as conn:
            user_id = conn.execute(
                "INSERT INTO chat_messages (role, content, conversation_id, payload_json) VALUES ('user', '联网问题', ?, ?)",
                (self.conversation_id, '{"web_search":true,"web_search_mode":"technical"}'),
            ).lastrowid
        self.store.start_run("legacy-binding", conversation_id=self.conversation_id, task_id=self.task_id, user_content="联网问题")
        self.store.bind_messages("legacy-binding", user_message_id=user_id)
        options = self.store.get_run("legacy-binding")["web_search_options"]
        self.assertTrue(options.enabled)
        self.assertEqual((options.topic, options.source_preference), ("general", "technical"))

    def test_legacy_waiting_snapshot_does_not_inherit_later_user_consent(self) -> None:
        snapshot = AgentRunSnapshot(route_kind="web_search", needs_plan=False,
                                    allowed_tools=["search_public_web"], messages=[AgentMessage(role="user", content="原任务")])
        save_run_snapshot(self.conversation_id, snapshot, self.db_path)
        with connect(self.db_path) as conn:
            conn.execute("INSERT INTO chat_messages (role, content, conversation_id, payload_json) VALUES ('user', '新任务', ?, ?)",
                         (self.conversation_id, '{"web_search":true,"web_search_mode":"technical"}'))
        loaded = load_run_snapshot(self.conversation_id, self.db_path)
        self.assertFalse(loaded.web_search_options.enabled)

    def test_legacy_waiting_snapshot_reads_bound_original_user_not_latest(self) -> None:
        snapshot = AgentRunSnapshot(route_kind="web_search", needs_plan=False,
                                    allowed_tools=["search_public_web"], messages=[AgentMessage(role="user", content="原任务")])
        with connect(self.db_path) as conn:
            user_id = conn.execute(
                "INSERT INTO chat_messages (role, content, conversation_id, payload_json) VALUES ('user', '原任务', ?, ?)",
                (self.conversation_id, '{"web_search":true,"web_search_mode":"technical"}'),
            ).lastrowid
        self.store.start_run("legacy-waiting", conversation_id=self.conversation_id, task_id=self.task_id, user_content="原任务")
        self.store.bind_messages("legacy-waiting", user_message_id=user_id)
        self.store.finish("legacy-waiting", AgentRunResult(content="请选择", provider="test", platform="manual", rounds=1,
                                                         status="waiting_user", snapshot=snapshot))
        save_run_snapshot(self.conversation_id, snapshot, self.db_path)
        with connect(self.db_path) as conn:
            conn.execute("INSERT INTO chat_messages (role, content, conversation_id, payload_json) VALUES ('user', '新任务', ?, ?)",
                         (self.conversation_id, '{"web_search":false,"web_search_mode":"general"}'))
        loaded = load_run_snapshot(self.conversation_id, self.db_path)
        self.assertTrue(loaded.web_search_options.enabled)
        self.assertEqual((loaded.web_search_options.topic, loaded.web_search_options.source_preference), ("general", "technical"))

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
            allowed_tools=["search_public_web"],
            rounds_used=2,
            plan=AgentPlan(
                goal="研究公司",
                route="company_research",
                steps=[AgentPlanStep(
                    id="step-1",
                    title="检索资料",
                    tool_name="search_public_web",
                    risk="external_read",
                )],
            ),
        )
        self.store.checkpoint("run-1", snapshot)

        loaded = self.store.get_run("run-1")
        self.assertEqual(loaded["route_kind"], "company_research")
        self.assertEqual(loaded["round_number"], 2)
        self.assertEqual(loaded["checkpoint"].allowed_tools, ["search_public_web"])
        self.assertFalse(loaded["checkpoint_invalid"])
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
        self.assertFalse(finished["result_invalid"])

    def test_run_timing_uses_persisted_start_and_remains_stable_after_repeated_finish(self) -> None:
        started_at = "2026-10-11T00:00:00.125+00:00"
        completed_at = "2026-10-11T00:00:06.650+00:00"
        with patch("app.agent.run_store._utc_now", side_effect=[started_at, completed_at]):
            started = self.store.start_run(
                "run-timed", conversation_id=self.conversation_id,
                task_id=self.task_id, user_content="定时测试",
            )
            result = AgentRunResult(content="完成", provider="test", platform="manual", rounds=1)
            self.assertIsNone(self.store.finish("run-timed", result))
        self.assertEqual(started["started_at"], started_at)
        self.assertEqual(result.started_at, started_at)
        self.assertEqual(result.completed_at, completed_at)
        self.assertEqual(result.duration_ms, 6525)

        replacement = result.model_copy(update={"content": "保留的部分内容"})
        with patch("app.agent.run_store._utc_now", return_value="2026-10-11T01:00:00.000+00:00"):
            self.store.finish("run-timed", replacement)
        stored = self.store.load_result("run-timed")
        self.assertEqual(stored.content, "保留的部分内容")
        self.assertEqual(stored.duration_ms, 6525)
        self.assertEqual(stored.completed_at, completed_at)
        self.assertEqual(self.store.get_run("run-timed")["completed_at"], completed_at)

    def test_all_execution_outcomes_preserve_measured_time(self) -> None:
        for status in ("done", "failed", "cancelled", "waiting_user"):
            with self.subTest(status=status), patch("app.agent.run_store._utc_now", side_effect=[
                "2026-10-11T00:00:00.000+00:00", "2026-10-11T00:00:01.500+00:00",
            ]):
                run_id = f"timed-{status}"
                self.store.start_run(
                    run_id, conversation_id=self.conversation_id,
                    task_id=self.task_id, user_content="定时测试",
                )
                result = AgentRunResult(
                    content="结束", provider="test", platform="manual", rounds=1, status=status,
                )
                self.store.finish(run_id, result)
                self.assertEqual(self.store.load_result(run_id).duration_ms, 1500)
                self.assertEqual(result.duration_ms, 1500)

    def test_concurrent_finish_keeps_the_first_completion_time_in_one_transaction(self) -> None:
        with patch("app.agent.run_store._utc_now", return_value="2026-10-11T00:00:00.000+00:00"):
            self.store.start_run(
                "concurrent-time", conversation_id=self.conversation_id,
                task_id=self.task_id, user_content="并发结束",
            )
        first_clock = threading.Event()
        release_first = threading.Event()
        second_attempt = threading.Event()
        second_read = threading.Event()
        failures = []
        results = [AgentRunResult(content="完成", provider="test", platform="manual", rounds=1) for _ in range(2)]

        class TracedConnection:
            def __init__(self, conn):
                self.conn = conn

            def execute(self, sql, *parameters):
                if threading.current_thread().name == "second-finisher" and sql == "BEGIN IMMEDIATE":
                    second_attempt.set()
                cursor = self.conn.execute(sql, *parameters)
                if threading.current_thread().name == "second-finisher" and sql.startswith("SELECT status"):
                    second_read.set()
                return cursor

        @contextmanager
        def traced_connect(db_path=None):
            with connect(db_path) as conn:
                yield TracedConnection(conn)

        def clock():
            if threading.current_thread().name == "first-finisher":
                first_clock.set()
                if not release_first.wait(5):
                    raise RuntimeError("测试未释放首个结束事务")
                return "2026-10-11T00:00:01.250+00:00"
            return "2026-10-11T00:00:02.500+00:00"

        def finish(index):
            try:
                self.store.finish("concurrent-time", results[index])
            except Exception as exc:
                failures.append(exc)

        first = threading.Thread(target=finish, args=(0,), name="first-finisher")
        second = threading.Thread(target=finish, args=(1,), name="second-finisher")
        with patch("app.agent.run_store.connect", traced_connect), patch("app.agent.run_store._utc_now", side_effect=clock) as mocked_clock:
            first.start()
            try:
                self.assertTrue(first_clock.wait(5))
                second.start()
                self.assertTrue(second_attempt.wait(5))
                self.assertFalse(second_read.is_set())
            finally:
                release_first.set()
                first.join(5)
                if second.ident is not None:
                    second.join(5)
            self.assertEqual(mocked_clock.call_count, 1)
        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(failures, [])
        self.assertTrue(second_read.is_set())
        self.assertEqual([result.duration_ms for result in results], [1250, 1250])
        self.assertEqual(self.store.load_result("concurrent-time").duration_ms, 1250)

    def test_waiting_user_resume_with_new_run_id_has_an_independent_duration(self) -> None:
        with patch("app.agent.run_store._utc_now", side_effect=[
            "2026-10-11T00:00:00.000+00:00", "2026-10-11T00:00:01.000+00:00",
            "2026-10-11T00:10:00.000+00:00", "2026-10-11T00:10:03.000+00:00",
        ]):
            self.store.start_run(
                "waiting-parent", conversation_id=self.conversation_id,
                task_id=self.task_id, user_content="需要确认",
            )
            self.store.finish("waiting-parent", AgentRunResult(
                content="请确认", provider="test", platform="manual", rounds=1, status="waiting_user",
            ))
            self.store.start_run(
                "resumed-child", conversation_id=self.conversation_id,
                task_id=self.task_id, user_content="确认继续",
            )
            self.store.link_waiting_resume(self.conversation_id, "resumed-child")
            result = AgentRunResult(content="完成", provider="test", platform="manual", rounds=2)
            self.store.finish("resumed-child", result)
        self.assertEqual(result.duration_ms, 3000)
        self.assertEqual(result.started_at, "2026-10-11T00:10:00.000+00:00")
        self.assertEqual(self.store.load_result("waiting-parent").duration_ms, 1000)

    def test_waiting_user_same_run_transition_does_not_reuse_previous_waiting_completion(self) -> None:
        with patch("app.agent.run_store._utc_now", side_effect=[
            "2026-10-11T00:00:00.000+00:00", "2026-10-11T00:00:01.000+00:00",
            "2026-10-11T00:00:03.000+00:00",
        ]):
            self.store.start_run(
                "waiting-transition", conversation_id=self.conversation_id,
                task_id=self.task_id, user_content="需要确认",
            )
            self.store.finish("waiting-transition", AgentRunResult(
                content="请确认", provider="test", platform="manual", rounds=1, status="waiting_user",
            ))
            result = AgentRunResult(content="完成", provider="test", platform="manual", rounds=2)
            self.store.finish("waiting-transition", result)
        self.assertEqual(result.duration_ms, 3000)
        self.assertEqual(result.completed_at, "2026-10-11T00:00:03.000+00:00")

    def test_legacy_sqlite_start_is_interpreted_as_utc_without_inventing_missing_time(self) -> None:
        self.store.start_run(
            "legacy-time", conversation_id=self.conversation_id,
            task_id=self.task_id, user_content="旧时间格式",
        )
        with connect(self.db_path) as conn:
            conn.execute("UPDATE agent_execution_runs SET started_at = '2026-10-11 00:00:00' WHERE run_id = 'legacy-time'")
        result = AgentRunResult(content="完成", provider="test", platform="manual", rounds=1)
        with patch("app.agent.run_store._utc_now", return_value="2026-10-11T00:00:02.500+00:00"):
            self.store.finish("legacy-time", result)
        self.assertEqual(result.started_at, "2026-10-11T00:00:00.000+00:00")
        self.assertEqual(result.duration_ms, 2500)

        missing = AgentRunResult(content="无记录", provider="test", platform="manual", rounds=1)
        self.store.finish("missing-run", missing)
        self.assertIsNone(missing.started_at)
        self.assertIsNone(missing.duration_ms)

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

    def test_latest_run_survives_incompatible_and_corrupt_persisted_json(self) -> None:
        self.store.start_run(
            "run-stale",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="旧检查点",
        )
        with connect(self.db_path) as conn:
            conn.execute(
                """
                UPDATE agent_execution_runs
                SET status = 'interrupted',
                    checkpoint_json = ?, result_json = ?
                WHERE run_id = 'run-stale'
                """,
                ('{"route_kind": "conversation"}', '{"provider": "test"}'),
            )
            conn.execute(
                """
                INSERT INTO agent_tool_executions
                    (run_id, fingerprint, tool_call_id, tool_name, arguments_json, result_json, risk)
                VALUES ('run-stale', 'broken', 'call-1', 'search_public_web', ?, ?, 'external_read')
                """,
                ('{not-json', 'also-not-json'),
            )

        loaded = self.store.latest_for_conversation(self.conversation_id)
        self.assertEqual(loaded["run_id"], "run-stale")
        self.assertEqual(loaded["status"], "interrupted")
        self.assertIsNone(loaded["checkpoint"])
        self.assertIsNone(loaded["result"])
        self.assertTrue(loaded["checkpoint_invalid"])
        self.assertTrue(loaded["result_invalid"])
        self.assertIsNone(self.store.load_checkpoint("run-stale"))
        self.assertIsNone(self.store.load_result("run-stale"))

        tools = self.store.list_tool_executions("run-stale")
        self.assertEqual(tools[0]["tool_name"], "search_public_web")
        self.assertTrue(tools[0]["arguments_invalid"])
        self.assertTrue(tools[0]["result_invalid"])

        with connect(self.db_path) as conn:
            conn.execute(
                """
                UPDATE agent_execution_runs
                SET checkpoint_json = '{truncated', result_json = 'not-json'
                WHERE run_id = 'run-stale'
                """
            )
        corrupt = self.store.latest_for_conversation(self.conversation_id)
        self.assertEqual(corrupt["run_id"], "run-stale")
        self.assertIsNone(corrupt["checkpoint"])
        self.assertTrue(corrupt["checkpoint_invalid"])
        self.assertTrue(corrupt["result_invalid"])


if __name__ == "__main__":
    unittest.main()

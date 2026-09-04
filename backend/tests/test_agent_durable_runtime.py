from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from app.agent.run_store import AgentRunStore
from app.agent.runtime import AgentRuntime, _tool_call_fingerprint
from app.db import connect, init_db
from app.domain import (
    AgentMessage,
    AgentPlan,
    AgentPlanStep,
    AgentRunSnapshot,
    ModelResponse,
    ToolCall,
    ToolDefinition,
    ToolResult,
)
from app.models import ModelProviderRegistry
from app.tools import ToolContext, ToolRegistry


class AgentDurableRuntimeTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "durable-runtime.db"
        init_db(self.db_path)
        with connect(self.db_path) as conn:
            self.conversation_id = conn.execute(
                "INSERT INTO conversations (title) VALUES ('Durable Agent')"
            ).lastrowid
            self.task_id = conn.execute(
                "INSERT INTO conversation_tasks (conversation_id) VALUES (?)",
                (self.conversation_id,),
            ).lastrowid
        self.store = AgentRunStore(self.db_path)

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_terminal_run_id_replays_result_without_calling_model_again(self) -> None:
        class CountingModel:
            name = "counting"

            def __init__(self) -> None:
                self.calls = 0

            async def generate(self, request):
                self.calls += 1
                return ModelResponse(content="持久化回答")

        model = CountingModel()
        runtime = self._runtime(model, ToolRegistry())

        first = await self._collect(
            runtime,
            "你好",
            run_id="same-run",
        )
        second = await self._collect(
            runtime,
            "你好",
            run_id="same-run",
        )

        self.assertEqual(model.calls, 1)
        self.assertEqual(first[-1].result.content, "持久化回答")
        self.assertEqual(second[-1].result.content, "持久化回答")
        self.assertTrue(any(event.type == "text_delta" for event in second))
        self.assertEqual(self.store.get_run("same-run")["status"], "completed")

    async def test_interrupted_run_resumes_checkpoint_without_duplicate_user_message(self) -> None:
        original = AgentMessage(role="user", content="原始任务")
        snapshot = AgentRunSnapshot(
            resume_mode="checkpoint",
            route_kind="conversation",
            needs_plan=False,
            messages=[original],
            rounds_used=1,
        )
        self.store.start_run(
            "resume-run",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="原始任务",
        )
        self.store.checkpoint("resume-run", snapshot)
        self.store.interrupt_active_runs()

        class CaptureModel:
            name = "capture"

            def __init__(self) -> None:
                self.requests = []

            async def generate(self, request):
                self.requests.append(request)
                return ModelResponse(content="从检查点完成")

        model = CaptureModel()
        runtime = self._runtime(model, ToolRegistry())

        events = await self._collect(runtime, "原始任务", run_id="resume-run")

        self.assertEqual(events[-1].result.status, "done")
        user_messages = [
            message.content
            for message in model.requests[0].messages
            if message.role == "user"
        ]
        self.assertEqual(user_messages, ["原始任务"])
        self.assertEqual(self.store.get_run("resume-run")["status"], "completed")

    async def test_completed_tool_is_replayed_after_crash_without_handler_execution(self) -> None:
        tool = CountingTool("research_company")
        tools = ToolRegistry()
        tools.register_handler(tool)
        plan = AgentPlan(
            goal="研究公司",
            route="company_research",
            steps=[AgentPlanStep(
                id="step-1",
                title="研究公司",
                tool_name="research_company",
                risk="external_read",
            )],
        )
        snapshot = AgentRunSnapshot(
            resume_mode="checkpoint",
            route_kind="company_research",
            needs_plan=True,
            allowed_tools=["research_company"],
            required_tools=["research_company"],
            plan=plan,
            messages=[AgentMessage(role="user", content="研究示例科技")],
        )
        arguments = {"company_name": "示例科技"}
        fingerprint = _tool_call_fingerprint("research_company", arguments)
        self.store.start_run(
            "tool-replay-run",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="研究示例科技",
        )
        self.store.checkpoint("tool-replay-run", snapshot)
        self.store.prepare_tool_call(
            "tool-replay-run",
            fingerprint,
            ToolCall(id="before-crash", name="research_company", arguments=arguments),
            tools.spec("research_company"),
        )
        self.store.record_tool_result(
            "tool-replay-run",
            fingerprint,
            ToolResult(ok=True, status="done", message="已持久化研究结果"),
        )
        self.store.interrupt_active_runs()

        model = ToolThenTextModel("research_company", arguments)
        runtime = self._runtime(model, tools)

        events = await self._collect(
            runtime,
            "研究示例科技",
            run_id="tool-replay-run",
        )

        self.assertEqual(events[-1].result.status, "done")
        self.assertEqual(tool.calls, 0)
        done = next(
            event
            for event in events[-1].result.events
            if event.tool_name == "research_company" and event.status == "done"
        )
        self.assertTrue(done.data["idempotent_replay"])

    async def test_interrupted_write_tool_is_blocked_instead_of_replayed(self) -> None:
        tool = CountingTool("propose_candidate_knowledge")
        tools = ToolRegistry()
        tools.register_handler(tool)
        arguments = {"category": "skill", "statement": "熟悉 Python"}
        fingerprint = _tool_call_fingerprint("propose_candidate_knowledge", arguments)
        plan = AgentPlan(
            goal="补充画像",
            route="profile_enrichment",
            steps=[AgentPlanStep(
                id="step-write",
                title="补充画像",
                tool_name="propose_candidate_knowledge",
                risk="local_pending_write",
            )],
        )
        snapshot = AgentRunSnapshot(
            resume_mode="checkpoint",
            route_kind="profile_enrichment",
            needs_plan=True,
            allowed_tools=["propose_candidate_knowledge"],
            required_tools=["propose_candidate_knowledge"],
            plan=plan,
            messages=[AgentMessage(role="user", content="记住我熟悉 Python")],
        )
        self.store.start_run(
            "uncertain-write-run",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="记住我熟悉 Python",
        )
        self.store.checkpoint("uncertain-write-run", snapshot)
        self.store.prepare_tool_call(
            "uncertain-write-run",
            fingerprint,
            ToolCall(
                id="write-before-crash",
                name="propose_candidate_knowledge",
                arguments=arguments,
            ),
            tools.spec("propose_candidate_knowledge"),
        )
        self.store.interrupt_active_runs()

        model = ToolThenTextModel("propose_candidate_knowledge", arguments)
        runtime = self._runtime(model, tools)

        events = await self._collect(
            runtime,
            "记住我熟悉 Python",
            run_id="uncertain-write-run",
        )

        result = events[-1].result
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error.code, "tool_execution_uncertain")
        self.assertEqual(tool.calls, 0)

    async def test_durable_cancel_stops_before_model_request(self) -> None:
        class ShouldNotRunModel:
            name = "cancelled"

            def __init__(self) -> None:
                self.calls = 0

            async def generate(self, request):
                self.calls += 1
                raise AssertionError("取消后不应请求模型")

        model = ShouldNotRunModel()
        self.store.start_run(
            "cancel-run",
            conversation_id=self.conversation_id,
            task_id=self.task_id,
            user_content="你好",
        )
        self.store.request_cancel("cancel-run")
        runtime = self._runtime(model, ToolRegistry())

        events = await self._collect(runtime, "你好", run_id="cancel-run")

        self.assertEqual(events[-1].result.status, "cancelled")
        self.assertEqual(model.calls, 0)
        self.assertEqual(self.store.get_run("cancel-run")["status"], "cancelled")

    async def test_durable_cancel_interrupts_inflight_model_request(self) -> None:
        class SlowModel:
            name = "slow-cancel"

            def __init__(self) -> None:
                self.started = asyncio.Event()
                self.cancelled = False

            async def generate(self, request):
                self.started.set()
                try:
                    await asyncio.sleep(10)
                except asyncio.CancelledError:
                    self.cancelled = True
                    raise
                return ModelResponse(content="不应完成")

        model = SlowModel()
        runtime = self._runtime(model, ToolRegistry())
        collector = asyncio.create_task(
            self._collect(runtime, "你好", run_id="inflight-cancel")
        )
        await asyncio.wait_for(model.started.wait(), timeout=1)

        self.assertTrue(self.store.request_cancel("inflight-cancel"))
        events = await asyncio.wait_for(collector, timeout=2)

        self.assertTrue(model.cancelled)
        self.assertEqual(events[-1].result.status, "cancelled")
        self.assertEqual(self.store.get_run("inflight-cancel")["status"], "cancelled")

    def _runtime(self, model, tools: ToolRegistry) -> AgentRuntime:
        models = ModelProviderRegistry()
        models.register(model.name, model)
        return AgentRuntime(
            models=models,
            tools=tools,
            model_provider=model.name,
            platform_name="manual",
            max_tool_rounds=5,
            run_store=self.store,
        )

    async def _collect(self, runtime: AgentRuntime, content: str, *, run_id: str):
        return [
            event
            async for event in runtime.run_stream(
                content,
                conversation_id=self.conversation_id,
                task_id=self.task_id,
                run_id=run_id,
            )
        ]


class CountingTool:
    def __init__(self, name: str) -> None:
        self.definition = ToolDefinition(
            name=name,
            description="持久化测试工具",
            input_schema={"type": "object", "additionalProperties": True},
        )
        self.calls = 0

    async def execute(self, arguments: dict, context: ToolContext) -> ToolResult:
        self.calls += 1
        return ToolResult(ok=True, status="done", message="工具完成")


class ToolThenTextModel:
    name = "tool-then-text"

    def __init__(self, tool_name: str, arguments: dict) -> None:
        self.tool_name = tool_name
        self.arguments = arguments
        self.calls = 0

    async def generate(self, request):
        self.calls += 1
        if self.calls == 1:
            return ModelResponse(
                tool_calls=[ToolCall(
                    id=f"resume-{self.tool_name}",
                    name=self.tool_name,
                    arguments=self.arguments,
                )]
            )
        return ModelResponse(content="恢复任务完成")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from app.agent.completion import validate_completion
from app.agent.orchestration import TaskRoute
from app.agent.tool_executor import ToolExecutor
from app.domain import AgentPlan, AgentPlanStep, ToolCall, ToolDefinition, ToolResult
from app.tooling import ToolSpec
from app.tools import ToolContext, ToolRegistry


class SearchTool:
    definition = ToolDefinition(
        name="test_search",
        description="测试搜索",
        input_schema={"type": "object"},
    )
    spec = ToolSpec(
        name="test_search",
        title="测试搜索",
        risk="external_read",
        capabilities=frozenset({"web.search"}),
    )

    async def execute(self, arguments, context):
        return ToolResult(ok=True, status="done", data={"items": []}, message="搜索完成")


class SlowTool:
    definition = ToolDefinition(
        name="test_slow",
        description="测试超时",
        input_schema={"type": "object"},
    )
    spec = ToolSpec(
        name="test_slow",
        title="测试超时",
        risk="read_only",
        capabilities=frozenset({"test.slow"}),
        timeout_seconds=0.01,
    )

    async def execute(self, arguments, context):
        await asyncio.sleep(1)
        return ToolResult(ok=True, status="done", message="不应完成")


class BrokenTool:
    definition = ToolDefinition(
        name="test_broken",
        description="测试异常",
        input_schema={"type": "object"},
    )
    spec = ToolSpec(
        name="test_broken",
        title="测试异常",
        risk="read_only",
        capabilities=frozenset({"test.broken"}),
    )

    async def execute(self, arguments, context):
        raise RuntimeError("boom")


class ToolHarnessTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tools = ToolRegistry()
        self.tools.register_handler(SearchTool())
        self.tools.register_handler(SlowTool())
        self.tools.register_handler(BrokenTool())
        self.executor = ToolExecutor(self.tools, default_timeout_seconds=5)
        self.context = ToolContext(platform_name="manual")

    def test_registry_discovers_tools_by_capability(self) -> None:
        self.assertEqual(
            self.tools.names_for_capabilities({"web.search"}),
            ["test_search"],
        )
        self.assertEqual(self.tools.spec("test_search").risk, "external_read")
        self.assertEqual(
            SearchTool.definition.output_schema,
            {"type": "object", "additionalProperties": True},
        )

    def test_completion_accepts_persisted_done_plan_step_after_resume(self) -> None:
        route = TaskRoute(
            kind="company_research",
            needs_plan=True,
            allowed_tools=("test_search",),
            required_tools=("test_search",),
        )
        plan = AgentPlan(
            goal="研究实体",
            route="company_research",
            steps=[
                AgentPlanStep(
                    id="step-1",
                    title="测试搜索",
                    tool_name="test_search",
                    risk="external_read",
                    status="done",
                )
            ],
        )

        self.assertTrue(validate_completion(route, [], plan).complete)

    def test_completion_accepts_tools_restored_from_snapshot(self) -> None:
        route = TaskRoute(
            kind="company_research",
            needs_plan=False,
            allowed_tools=("test_search",),
            required_tools=("test_search",),
        )

        validation = validate_completion(route, [], None, {"test_search"})

        self.assertTrue(validation.complete)
        self.assertEqual(validation.missing_tools, ())

    async def test_executor_normalizes_success_and_records_audit(self) -> None:
        with patch("app.agent.tool_executor.record_tool_call_event") as record:
            result = await self.executor.execute(
                ToolCall(id="call-1", name="test_search", arguments={}),
                self.context,
                round_number=2,
                conversation_id=7,
            )

        self.assertEqual(result.status, "done")
        self.assertEqual(result.data, {"items": []})
        self.assertEqual(record.call_args.kwargs["tool_name"], "test_search")
        self.assertEqual(record.call_args.kwargs["status"], "done")

    async def test_executor_uses_spec_timeout(self) -> None:
        result = await self.executor.execute(
            ToolCall(id="call-2", name="test_slow", arguments={}),
            self.context,
            round_number=1,
            conversation_id=None,
        )

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error.code, "tool_timeout")
        self.assertTrue(result.error.retryable)

    async def test_executor_normalizes_handler_exceptions(self) -> None:
        result = await self.executor.execute(
            ToolCall(id="call-3", name="test_broken", arguments={}),
            self.context,
            round_number=1,
            conversation_id=None,
        )

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error.code, "tool_execution_failed")


if __name__ == "__main__":
    unittest.main()

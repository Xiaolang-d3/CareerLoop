from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from pydantic import BaseModel, Field, ValidationError

from app.agent.completion import validate_completion
from app.agent.orchestration import TaskRoute
from app.agent.tool_executor import ToolExecutor
from app.domain import AgentPlan, AgentPlanStep, ToolCall, ToolDefinition, ToolResult
from app.tooling import ToolSpec
from app.tools import ToolContext, ToolRegistry
from app.tools.errors import describe_validation_error


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


class ValidatedTool:
    class Arguments(BaseModel):
        query: str = Field(min_length=2)
        limit: int = Field(default=3, ge=1, le=10)

    definition = ToolDefinition(
        name="test_validated",
        description="测试中央参数校验",
        input_schema=Arguments.model_json_schema(),
    )
    spec = ToolSpec(
        name="test_validated",
        title="测试中央参数校验",
        risk="read_only",
        capabilities=frozenset({"test.validated"}),
    )
    arguments_model = Arguments

    def __init__(self) -> None:
        self.calls = 0
        self.seen: dict | None = None

    async def execute(self, arguments, context):
        self.calls += 1
        self.seen = arguments
        return ToolResult(ok=True, status="done", message="参数通过")


class ToolHarnessTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tools = ToolRegistry()
        self.tools.register_handler(SearchTool())
        self.tools.register_handler(SlowTool())
        self.tools.register_handler(BrokenTool())
        self.validated = ValidatedTool()
        self.tools.register_handler(self.validated)
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

    async def test_executor_rejects_invalid_arguments_before_handler(self) -> None:
        result = await self.executor.execute(
            ToolCall(id="call-4", name="test_validated", arguments={"query": "x"}),
            self.context,
            round_number=1,
            conversation_id=None,
        )

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error.code, "invalid_arguments")
        self.assertEqual(result.message, "工具 test_validated 参数不合法")
        self.assertIn("query", result.error.message)
        self.assertNotIn("\n", result.error.message)
        self.assertEqual(self.validated.calls, 0)

    async def test_executor_passes_normalized_arguments_to_handler(self) -> None:
        result = await self.executor.execute(
            ToolCall(id="call-5", name="test_validated", arguments={"query": "有效查询", "unknown": 1}),
            self.context,
            round_number=1,
            conversation_id=None,
        )

        self.assertEqual(result.status, "done")
        self.assertEqual(self.validated.calls, 1)
        self.assertEqual(self.validated.seen, {"query": "有效查询", "limit": 3})

    def test_validation_error_summary_is_compact_and_bounded(self) -> None:
        with self.assertRaises(ValidationError) as caught:
            ValidatedTool.Arguments.model_validate({"query": "x", "limit": 99})

        summary = describe_validation_error(caught.exception)

        self.assertNotIn("\n", summary)
        self.assertIn("query", summary)
        self.assertIn("limit", summary)

        class Wide(BaseModel):
            a: str
            b: str
            c: str
            d: str
            e: str
            f: str
            g: str

        with self.assertRaises(ValidationError) as wide:
            Wide.model_validate({})

        capped = describe_validation_error(wide.exception)
        self.assertEqual(capped.count("；"), 4)

    def test_validation_error_summary_handles_non_pydantic_errors(self) -> None:
        summary = describe_validation_error(ValueError("bad\nvalue"))

        self.assertEqual(summary, "bad value")


if __name__ == "__main__":
    unittest.main()

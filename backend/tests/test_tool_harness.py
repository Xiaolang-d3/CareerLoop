from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import patch

from pydantic import BaseModel, Field, ValidationError

from app.agent.completion import validate_completion
from app.agent.orchestration import TaskRoute
from app.agent.tool_executor import ToolExecutor
from app.domain import AgentPlan, AgentPlanStep, ToolCall, ToolDefinition, ToolError, ToolResult
from app.tooling import ToolSpec
from app.tools import ToolContext, ToolRegistry
from app.tools.errors import describe_validation_error
from app.tools.limits import (
    MAX_RESULT_DATA_CHARS,
    MAX_RESULT_ITEMS,
    MAX_RESULT_MESSAGE_CHARS,
    MAX_RESULT_STRING_CHARS,
    govern_tool_result,
)


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


class HugeResultTool:
    definition = ToolDefinition(
        name="test_huge",
        description="测试结果大小治理",
        input_schema={"type": "object"},
    )
    spec = ToolSpec(
        name="test_huge",
        title="测试结果大小治理",
        risk="read_only",
        capabilities=frozenset({"test.huge"}),
    )

    async def execute(self, arguments, context):
        return ToolResult(
            ok=True,
            status="done",
            data={
                "items": [
                    {"content": "长" * 5000, "url": f"https://example.com/{index}"}
                    for index in range(40)
                ]
            },
            message="巨型结果",
        )


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

    async def test_executor_governs_oversized_results(self) -> None:
        self.tools.register_handler(HugeResultTool())

        result = await self.executor.execute(
            ToolCall(id="call-6", name="test_huge", arguments={}),
            self.context,
            round_number=1,
            conversation_id=None,
        )

        self.assertEqual(result.status, "done")
        self.assertIs(result.data["truncated"], True)
        self.assertLessEqual(len(json.dumps(result.data, ensure_ascii=False)), MAX_RESULT_DATA_CHARS)

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


class ToolResultGovernanceTest(unittest.TestCase):
    def test_small_result_is_unchanged_without_marker(self) -> None:
        result = ToolResult(ok=True, status="done", data={"a": "b", "note": "…（已截断）"}, message="ok")

        governed = govern_tool_result(result)

        self.assertEqual(governed, result)
        self.assertEqual(governed.message, "ok")
        self.assertIsNone(governed.error)
        self.assertNotIn("truncated", governed.data)

    def test_long_message_and_error_are_bounded(self) -> None:
        long_text = "长" * (MAX_RESULT_MESSAGE_CHARS + 500)
        result = ToolResult(
            ok=False,
            status="failed",
            message=long_text,
            error=ToolError(code="x", message=long_text),
        )

        governed = govern_tool_result(result)

        self.assertLessEqual(len(governed.message), MAX_RESULT_MESSAGE_CHARS)
        self.assertLessEqual(len(governed.error.message), MAX_RESULT_MESSAGE_CHARS)
        self.assertIs(governed.data["truncated"], True)

    def test_data_strings_lists_and_depth_are_bounded(self) -> None:
        deep: object = "末"
        for _ in range(12):
            deep = {"value": deep}
        result = ToolResult(
            ok=True,
            status="done",
            data={
                "text": "a" * (MAX_RESULT_STRING_CHARS + 100),
                "items": list(range(MAX_RESULT_ITEMS + 20)),
                "deep": deep,
            },
            message="ok",
        )

        governed = govern_tool_result(result)

        self.assertLessEqual(len(governed.data["text"]), MAX_RESULT_STRING_CHARS)
        self.assertEqual(len(governed.data["items"]), MAX_RESULT_ITEMS)
        node = governed.data["deep"]
        while isinstance(node, dict):
            node = node["value"]
        self.assertIsInstance(node, str)
        self.assertIn("已截断", node)
        self.assertIs(governed.data["truncated"], True)

    def test_total_data_budget_caps_many_strings(self) -> None:
        data = {"blobs": ["字" * MAX_RESULT_STRING_CHARS for _ in range(30)]}
        result = ToolResult(ok=True, status="done", data=data, message="ok")

        governed = govern_tool_result(result)

        self.assertLessEqual(len(json.dumps(governed.data, ensure_ascii=False)), MAX_RESULT_DATA_CHARS)
        self.assertIs(governed.data["truncated"], True)

    def test_total_json_budget_includes_keys_structure_and_escaped_values(self) -> None:
        cases = {
            "numbers": {"items": [[123456789012345 for _ in range(50)] for _ in range(50)]},
            "long_key": {"k" * 50000: True, "valid": "kept"},
            "escaped": {"items": ["\x00\n\"\\" * 2000 for _ in range(50)]},
            "urls": {"sources": [{"url": f"https://example.com/{i}/" + "x" * 2000} for i in range(50)]},
        }
        for name, data in cases.items():
            with self.subTest(name=name):
                result = ToolResult(ok=True, status="done", data=data, message="ok")
                original_json = json.dumps(result.data, ensure_ascii=False)

                governed = govern_tool_result(result)

                self.assertLessEqual(len(json.dumps(governed.data, ensure_ascii=False)), MAX_RESULT_DATA_CHARS)
                self.assertIs(governed.data["truncated"], True)
                self.assertEqual(govern_tool_result(governed), governed)
                self.assertEqual(json.dumps(result.data, ensure_ascii=False), original_json)
                if name == "urls":
                    original_urls = {source["url"] for source in data["sources"]}
                    retained_urls = {source["url"] for source in governed.data["sources"] if "url" in source}
                    self.assertTrue(retained_urls)
                    self.assertLessEqual(retained_urls, original_urls)

    def test_oversized_urls_are_omitted_instead_of_rewritten(self) -> None:
        for key in ("url", "source_url", "href"):
            with self.subTest(key=key):
                result = ToolResult(
                    ok=True,
                    status="done",
                    data={key: "https://example.com/" + "x" * MAX_RESULT_STRING_CHARS},
                    message="ok",
                )

                governed = govern_tool_result(result)

                self.assertNotIn(key, governed.data)
                self.assertIs(governed.data["truncated"], True)

    def test_marker_fits_at_the_key_limit_and_governance_stays_idempotent(self) -> None:
        data = {f"item_{index}": index for index in range(MAX_RESULT_ITEMS)}
        clean = ToolResult(ok=True, status="done", data=data, message="ok")
        self.assertEqual(govern_tool_result(clean), clean)

        oversized = clean.model_copy(update={"message": "长" * (MAX_RESULT_MESSAGE_CHARS + 1)})
        governed = govern_tool_result(oversized)

        self.assertEqual(len(governed.data), MAX_RESULT_ITEMS)
        self.assertIs(governed.data["truncated"], True)
        self.assertEqual(govern_tool_result(governed), governed)

    def test_governance_is_idempotent(self) -> None:
        nested: object = "x"
        for _ in range(8):
            nested = {"value": nested}
        result = ToolResult(
            ok=True,
            status="done",
            data={
                "text": "a" * 5000,
                "items": list(range(80)),
                "nested": nested,
                "blobs": ["字" * 4000 for _ in range(20)],
            },
            message="m" * (MAX_RESULT_MESSAGE_CHARS + 50),
        )

        once = govern_tool_result(result)

        self.assertEqual(govern_tool_result(once), once)

    def test_source_urls_survive_governance(self) -> None:
        urls = [f"https://example.com/research/{index}?ref=abcdef" for index in range(8)]
        data = {
            "sources": [{"url": url, "content": "长" * 5000} for url in urls],
            "evidence": [{"url": url, "excerpt": "长" * 5000} for url in urls],
        }
        result = ToolResult(ok=True, status="done", data=data, message="ok")

        governed = govern_tool_result(result)

        self.assertEqual([source["url"] for source in governed.data["sources"]], urls)
        self.assertEqual([item["url"] for item in governed.data["evidence"]], urls)
        self.assertIs(governed.data["truncated"], True)


if __name__ == "__main__":
    unittest.main()

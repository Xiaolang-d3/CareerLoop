from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app import db
import app.api.attachments as resources_module
import app.chat.execution as main_module
from app.agent.snapshots import load_run_snapshot, save_run_snapshot
from app.chat.conversations import create_conversation, ensure_active_task
from app.domain import AgentClarification, AgentRunResult, AgentRunSnapshot, AgentStreamEvent, ClarificationOption, ToolError
from app.main import app
from app.chat.execution import _active_chat_runs, _chat_run_key, cancel_current_agent_task
from api_client import create_authenticated_client


class ChatStreamingApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = db.DB_PATH
        db.DB_PATH = Path(self.temp_dir.name) / "streaming.db"
        db.init_db()
        self.client = create_authenticated_client(app)

    def tearDown(self) -> None:
        self.client.close()
        db.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def run_ag_ui(self, conversation_id: int, content: str, run_id: str) -> list[dict]:
        with self.client.stream("POST", "/ag-ui", json={
            "threadId": str(conversation_id), "runId": run_id, "state": {},
            "messages": [{"id": f"user-{run_id}", "role": "user", "content": content}],
            "tools": [], "context": [], "forwardedProps": {},
        }) as response:
            self.assertEqual(response.status_code, 200)
            return [json.loads(line.removeprefix("data: ")) for line in response.iter_lines() if line.startswith("data: ")]

    def with_runtime(self, runtime, action):
        original = main_module.get_agent_runtime
        main_module.get_agent_runtime = lambda: runtime
        try:
            return action()
        finally:
            main_module.get_agent_runtime = original

    def test_ag_ui_emits_lifecycle_text_state_and_persists_messages(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "流式测试"}).json()

        class Runtime:
            async def run_stream(self, *args, **kwargs):
                yield AgentStreamEvent(type="text_delta", delta="基于本地资料")
                yield AgentStreamEvent(type="text_delta", delta="完成回答。")
                yield AgentStreamEvent(type="completed", result=AgentRunResult(
                    content="基于本地资料完成回答。", provider="test", platform="manual", rounds=1,
                ))

        events = self.with_runtime(Runtime(), lambda: self.run_ag_ui(conversation["id"], "总结我的资料", "run-lifecycle"))
        types = [event["type"] for event in events]
        self.assertEqual(types[0], "RUN_STARTED")
        self.assertIn("TEXT_MESSAGE_START", types)
        self.assertIn("TEXT_MESSAGE_CONTENT", types)
        self.assertIn("STATE_SNAPSHOT", types)
        self.assertEqual(types[-1], "RUN_FINISHED")
        text = "".join(event["delta"] for event in events if event["type"] == "TEXT_MESSAGE_CONTENT")
        self.assertEqual(text, "基于本地资料完成回答。")
        messages = self.client.get(f"/chat/messages?conversation_id={conversation['id']}").json()
        self.assertEqual([message["role"] for message in messages], ["user", "assistant"])

    def test_ag_ui_requires_user_text(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "空输入"}).json()
        response = self.client.post("/ag-ui", json={
            "threadId": str(conversation["id"]), "runId": "run-empty", "state": {},
            "messages": [], "tools": [], "context": [], "forwardedProps": {},
        })
        self.assertEqual(response.status_code, 422)

    def test_agent_failure_uses_stable_run_error(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "失败"}).json()

        class Runtime:
            async def run_stream(self, *args, **kwargs):
                yield AgentStreamEvent(type="completed", result=AgentRunResult(
                    content="模型服务认证失败。", provider="test", platform="manual", rounds=1,
                    status="failed", error=ToolError(code="authentication_failed", message="模型服务认证失败"),
                ))

        events = self.with_runtime(Runtime(), lambda: self.run_ag_ui(conversation["id"], "请回答", "run-failed"))
        error = next(event for event in events if event["type"] == "RUN_ERROR")
        self.assertEqual(error["code"], "authentication_failed")
        self.assertNotIn("RUN_FINISHED", [event["type"] for event in events])

    def test_waiting_user_is_reported_in_state_snapshot(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "等待"}).json()

        class Runtime:
            async def run_stream(self, *args, **kwargs):
                yield AgentStreamEvent(type="completed", result=AgentRunResult(
                    content="请确认是否继续。", provider="test", platform="manual", rounds=1,
                    status="waiting_user",
                ))

        events = self.with_runtime(Runtime(), lambda: self.run_ag_ui(conversation["id"], "整理资料", "run-wait"))
        snapshot = next(event["snapshot"] for event in events if event["type"] == "STATE_SNAPSHOT")
        self.assertEqual(snapshot["careerLoop"]["status"], "waiting_user")

    def test_repeated_run_id_replays_without_duplicate_execution(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "幂等"}).json()

        class Runtime:
            def __init__(self):
                self.calls = 0

            async def run_stream(self, *args, **kwargs):
                self.calls += 1
                yield AgentStreamEvent(type="text_delta", delta="只执行一次")
                yield AgentStreamEvent(type="completed", result=AgentRunResult(
                    content="只执行一次", provider="test", platform="manual", rounds=1,
                ))

        runtime = Runtime()
        def run_twice():
            first = self.run_ag_ui(conversation["id"], "执行", "stable-run")
            second = self.run_ag_ui(conversation["id"], "执行", "stable-run")
            return first, second
        first, second = self.with_runtime(runtime, run_twice)
        self.assertEqual(runtime.calls, 1)
        for events in (first, second):
            self.assertEqual("".join(event["delta"] for event in events if event["type"] == "TEXT_MESSAGE_CONTENT"), "只执行一次")

    def test_waiting_snapshot_is_resumed_only_for_matching_option(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "恢复"}).json()
        save_run_snapshot(conversation["id"], AgentRunSnapshot(
            route_kind="library_search", needs_plan=True, allowed_tools=["search_library"],
            clarification=AgentClarification(
                question="要查哪份资料？",
                options=[ClarificationOption(id="one", label="项目笔记", send="查项目笔记")],
            ), rounds_used=1,
        ))
        captured = []

        class Runtime:
            async def run_stream(self, *args, **kwargs):
                captured.append(kwargs.get("resume"))
                yield AgentStreamEvent(type="completed", result=AgentRunResult(
                    content="完成", provider="test", platform="manual", rounds=1,
                ))

        self.with_runtime(Runtime(), lambda: self.run_ag_ui(conversation["id"], "换个话题", "run-new-topic"))
        self.assertIsNone(captured[-1])
        self.assertIsNone(load_run_snapshot(conversation["id"]))

        save_run_snapshot(conversation["id"], AgentRunSnapshot(
            route_kind="library_search", needs_plan=True, allowed_tools=["search_library"],
            clarification=AgentClarification(
                question="要查哪份资料？",
                options=[ClarificationOption(id="one", label="项目笔记", send="查项目笔记")],
            ), rounds_used=1,
        ))
        self.with_runtime(Runtime(), lambda: self.run_ag_ui(conversation["id"], "查项目笔记", "run-resume"))
        self.assertIsNotNone(captured[-1])
        self.assertEqual(captured[-1].route_kind, "library_search")

    def test_attachment_config_never_returns_storage_secrets(self) -> None:
        original = resources_module.get_settings
        resources_module.get_settings = lambda: SimpleNamespace(
            attachment_storage="minio", attachment_vision_enabled=True,
            attachment_vision_url_ttl_seconds=300, minio_endpoint="127.0.0.1:9000",
            minio_access_key="access", minio_secret_key="secret", minio_bucket="careerloop",
            minio_public_endpoint="https://files.example.test",
        )
        try:
            payload = self.client.get("/attachments/config").json()
        finally:
            resources_module.get_settings = original
        self.assertTrue(payload["vision_ready"])
        self.assertNotIn("minio_secret_key", payload)
        self.assertNotIn("minio_access_key", payload)

    def test_rewind_deletes_selected_user_turn_and_following_answer(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "回退"}).json()

        class Runtime:
            async def run_stream(self, *args, **kwargs):
                yield AgentStreamEvent(type="completed", result=AgentRunResult(
                    content="回答", provider="test", platform="manual", rounds=1,
                ))

        self.with_runtime(Runtime(), lambda: self.run_ag_ui(conversation["id"], "问题", "run-rewind"))
        messages = self.client.get(f"/chat/messages?conversation_id={conversation['id']}").json()
        response = self.client.delete(f"/chat/messages/{messages[0]['id']}/tail?conversation_id={conversation['id']}")
        self.assertEqual(response.json()["deleted"], 2)

    def test_preview_origin_is_allowed_by_cors(self) -> None:
        response = self.client.options("/health", headers={
            "Origin": "http://127.0.0.1:4173", "Access-Control-Request-Method": "GET",
        })
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:4173")


class ChatCancellationTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = db.DB_PATH
        db.DB_PATH = Path(self.temp_dir.name) / "cancel.db"
        db.init_db()

    async def asyncTearDown(self) -> None:
        for task in list(_active_chat_runs.values()):
            task.cancel()
        await asyncio.gather(*_active_chat_runs.values(), return_exceptions=True)
        _active_chat_runs.clear()
        db.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    async def test_cancel_endpoint_cancels_registered_run(self) -> None:
        conversation = create_conversation("取消测试")
        ensure_active_task(conversation["id"])
        task = asyncio.create_task(asyncio.Event().wait())
        _active_chat_runs[_chat_run_key(conversation["id"])] = task
        result = await cancel_current_agent_task(conversation["id"])
        await asyncio.gather(task, return_exceptions=True)
        self.assertTrue(result["cancelled"])
        self.assertTrue(task.cancelled())


if __name__ == "__main__":
    unittest.main()

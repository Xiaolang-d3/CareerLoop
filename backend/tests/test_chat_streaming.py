from __future__ import annotations

import json
import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import db
import app.main as main_module
import app.api.resources as resources_module
from app.conversations import create_conversation, ensure_active_task
from app.domain import AgentRunResult, AgentStreamEvent, ToolError
from app.main import (
    _active_chat_runs,
    _is_workflow_status_query,
    app,
    cancel_current_agent_task,
)


class ChatStreamingApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = db.DB_PATH
        db.DB_PATH = Path(self.temp_dir.name) / "streaming.db"
        db.init_db()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        db.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def run_ag_ui(self, conversation_id: int, content: str, run_id: str) -> list[dict]:
        with self.client.stream(
            "POST",
            "/ag-ui",
            json={
                "threadId": str(conversation_id),
                "runId": run_id,
                "state": {},
                "messages": [
                    {"id": f"user-{run_id}", "role": "user", "content": content}
                ],
                "tools": [],
                "context": [],
                "forwardedProps": {},
            },
        ) as response:
            self.assertEqual(response.status_code, 200)
            return [
                json.loads(line.removeprefix("data: "))
                for line in response.iter_lines()
                if line.startswith("data: ")
            ]

    def test_local_status_answer_uses_sse_and_is_persisted(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "流式测试"}).json()
        events = self.run_ag_ui(conversation["id"], "查看当前进度", "run-local-status")
        snapshot = next(event["snapshot"] for event in events if event["type"] == "STATE_SNAPSHOT")
        self.assertEqual(snapshot["bossCopilot"]["assistantMessage"]["role"], "assistant")
        self.assertIn("当前工作流", snapshot["bossCopilot"]["assistantMessage"]["content"])

        messages = self.client.get(
            f"/chat/messages?conversation_id={conversation['id']}"
        ).json()
        self.assertEqual([message["role"] for message in messages], ["user", "assistant"])

    def test_status_update_intent_is_not_misrouted_as_status_query(self) -> None:
        self.assertTrue(_is_workflow_status_query("再次查看当前进度"))
        self.assertFalse(_is_workflow_status_query("请更新投递状态为已投递"))

    def test_legacy_write_endpoints_are_not_available(self) -> None:
        self.assertIn(self.client.post("/chat/messages", json={"content": "测试"}).status_code, {404, 405})
        self.assertIn(self.client.post("/jobs", json={}).status_code, {404, 405})
        self.assertIn(self.client.post("/jobs/manual-import", json={}).status_code, {404, 405})
        self.assertEqual(self.client.get("/jobs").status_code, 404)
        self.assertIn(self.client.post("/applications", json={}).status_code, {404, 405})
        self.assertEqual(self.client.get("/applications").status_code, 404)
        self.assertIn(self.client.post("/profiles", json={}).status_code, {404, 405})

    def test_ag_ui_endpoint_emits_standard_lifecycle_text_and_state_events(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "AG-UI 测试"}).json()
        body = {
            "threadId": str(conversation["id"]),
            "runId": "run-test-status",
            "state": {},
            "messages": [{"id": "user-test", "role": "user", "content": "查看当前进度"}],
            "tools": [],
            "context": [],
            "forwardedProps": {"source": "test"},
        }

        with self.client.stream("POST", "/ag-ui", json=body) as response:
            self.assertEqual(response.status_code, 200)
            events = [
                json.loads(line.removeprefix("data: "))
                for line in response.iter_lines()
                if line.startswith("data: ")
            ]

        event_types = [event["type"] for event in events]
        self.assertEqual(event_types[0], "RUN_STARTED")
        self.assertIn("TEXT_MESSAGE_START", event_types)
        self.assertIn("TEXT_MESSAGE_CONTENT", event_types)
        self.assertIn("TEXT_MESSAGE_END", event_types)
        self.assertIn("STATE_SNAPSHOT", event_types)
        self.assertEqual(event_types[-1], "RUN_FINISHED")

        run_started = events[0]
        self.assertEqual(run_started["threadId"], str(conversation["id"]))
        self.assertEqual(run_started["runId"], "run-test-status")
        text = "".join(
            event["delta"] for event in events if event["type"] == "TEXT_MESSAGE_CONTENT"
        )
        self.assertIn("当前工作流", text)
        snapshot = next(event["snapshot"] for event in events if event["type"] == "STATE_SNAPSHOT")
        self.assertEqual(snapshot["bossCopilot"]["status"], "done")
        self.assertEqual(snapshot["bossCopilot"]["assistantMessage"]["role"], "assistant")

    def test_ag_ui_endpoint_requires_a_user_text_message(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "AG-UI 空输入"}).json()
        response = self.client.post(
            "/ag-ui",
            json={
                "threadId": str(conversation["id"]),
                "runId": "run-empty",
                "state": {},
                "messages": [],
                "tools": [],
                "context": [],
                "forwardedProps": {},
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_ag_ui_reports_agent_failure_as_run_error(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "AG-UI 失败"}).json()

        class FailedRuntime:
            async def run_stream(self, *args, **kwargs):
                yield AgentStreamEvent(
                    type="completed",
                    result=AgentRunResult(
                        content="模型服务认证失败。",
                        provider="openai",
                        platform="manual",
                        rounds=1,
                        status="failed",
                        error=ToolError(
                            code="authentication_failed",
                            message="模型服务认证失败",
                        ),
                    ),
                )

        original_get_agent_runtime = main_module.get_agent_runtime
        main_module.get_agent_runtime = lambda: FailedRuntime()
        try:
            with self.client.stream(
                "POST",
                "/ag-ui",
                json={
                    "threadId": str(conversation["id"]),
                    "runId": "run-failed",
                    "state": {},
                    "messages": [
                        {"id": "user-failed", "role": "user", "content": "分析岗位 1"}
                    ],
                    "tools": [],
                    "context": [],
                    "forwardedProps": {},
                },
            ) as response:
                self.assertEqual(response.status_code, 200)
                events = [
                    json.loads(line.removeprefix("data: "))
                    for line in response.iter_lines()
                    if line.startswith("data: ")
                ]
        finally:
            main_module.get_agent_runtime = original_get_agent_runtime

        event_types = [event["type"] for event in events]
        self.assertIn("RUN_ERROR", event_types)
        self.assertNotIn("RUN_FINISHED", event_types)
        snapshot = next(event["snapshot"] for event in events if event["type"] == "STATE_SNAPSHOT")
        self.assertEqual(snapshot["bossCopilot"]["status"], "failed")
        run_error = next(event for event in events if event["type"] == "RUN_ERROR")
        self.assertEqual(run_error["code"], "authentication_failed")

    def test_attachments_config_reports_safe_vision_capability(self) -> None:
        original_get_settings = resources_module.get_settings
        resources_module.get_settings = lambda: SimpleNamespace(
            attachment_storage="minio",
            attachment_vision_enabled=True,
            attachment_vision_url_ttl_seconds=300,
            minio_endpoint="127.0.0.1:9000",
            minio_access_key="access",
            minio_secret_key="secret",
            minio_bucket="bosscopilot-attachments",
            minio_public_endpoint="https://files.example.test",
        )
        try:
            response = self.client.get("/attachments/config")
        finally:
            resources_module.get_settings = original_get_settings

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["vision_ready"])
        self.assertEqual(payload["storage"], "minio")
        self.assertTrue(any(check["key"] == "vision_public_url" for check in payload["checks"]))
        self.assertNotIn("minio_public_endpoint", payload)
        self.assertNotIn("minio_secret_key", payload)

    def test_rewind_removes_selected_user_turn_and_following_messages(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "编辑测试"}).json()
        for index, content in enumerate(("查看当前进度", "再次查看状态"), start=1):
            self.run_ag_ui(conversation["id"], content, f"run-rewind-{index}")

        messages = self.client.get(
            f"/chat/messages?conversation_id={conversation['id']}"
        ).json()
        second_user = next(message for message in messages if message["content"] == "再次查看状态")

        response = self.client.delete(
            f"/chat/messages/{second_user['id']}/tail?conversation_id={conversation['id']}"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted"], 2)

        remaining = self.client.get(
            f"/chat/messages?conversation_id={conversation['id']}"
        ).json()
        self.assertEqual(
            [message["content"] for message in remaining],
            [message["content"] for message in messages[:2]],
        )

    def test_rewind_rejects_assistant_message(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "非法回退"}).json()
        events = self.run_ag_ui(conversation["id"], "查看当前状态", "run-invalid-rewind")
        snapshot = next(event["snapshot"] for event in events if event["type"] == "STATE_SNAPSHOT")
        assistant = snapshot["bossCopilot"]["assistantMessage"]

        rewind = self.client.delete(
            f"/chat/messages/{assistant['id']}/tail?conversation_id={conversation['id']}"
        )
        self.assertEqual(rewind.status_code, 400)

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

        async def wait_forever() -> None:
            await asyncio.Event().wait()

        task = asyncio.create_task(wait_forever())
        _active_chat_runs[conversation["id"]] = task

        result = await cancel_current_agent_task(conversation["id"])
        await asyncio.gather(task, return_exceptions=True)

        self.assertTrue(result["cancelled"])
        self.assertTrue(task.cancelled())


if __name__ == "__main__":
    unittest.main()

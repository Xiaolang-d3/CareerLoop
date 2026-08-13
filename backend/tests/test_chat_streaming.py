from __future__ import annotations

import json
import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app import db
import app.main as main_module
import app.api.resources as resources_module
from app.conversations import create_conversation, ensure_active_task
from app.domain import AgentRunResult, AgentStreamEvent, ToolError
from app.jobs import create_job
from app.main import (
    _active_chat_runs,
    _is_workflow_status_query,
    app,
    cancel_current_agent_task,
)
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

    def seed_confirmed_career_profile(
        self,
        *,
        name: str,
        resume_text: str,
        cities: list[str] | None = None,
        salary_min: int | None = None,
    ) -> None:
        self.assertEqual(
            self.client.put(
                "/career-profile",
                json={"name": name, "locale": "zh-CN", "privacy_mode": "redacted"},
            ).status_code,
            200,
        )
        source_response = self.client.post(
            "/career-profile/sources",
            json={
                "source_type": "resume",
                "title": "测试简历",
                "content": resume_text,
                "privacy_mode": "redacted",
                "allow_model_original": False,
                "extract_knowledge": False,
            },
        )
        self.assertEqual(source_response.status_code, 200)
        source_id = source_response.json()["source"]["id"]
        for category, statement, excerpt in (
            ("experience", "负责 Agent 产品规划和需求分析", "Agent 产品规划和需求分析"),
            ("skill", "具备 Python 相关经验", "Python"),
            ("project", "使用 Python 完成内部工具和产品原型", "使用 Python 完成"),
        ):
            proposed = self.client.post(
                "/career-profile/facts",
                json={
                    "category": category,
                    "statement": statement,
                    "source_id": source_id,
                    "excerpt": excerpt,
                },
            )
            self.assertEqual(proposed.status_code, 200)
            reviewed = self.client.post(
                f"/career-profile/facts/{proposed.json()['id']}/review",
                json={"action": "confirm"},
            )
            self.assertEqual(reviewed.status_code, 200)
        strategy = self.client.post(
            "/career-profile/strategies",
            json={
                "name": "AI 产品经理",
                "target_roles": ["AI 产品经理"],
                "regions": cities or [],
                "salary_min": salary_min,
                "is_active": True,
                "priority": 100,
            },
        )
        self.assertEqual(strategy.status_code, 200)

    def create_completed_evaluation(self, job_id: int) -> dict:
        created = self.client.post(
            f"/jobs/{job_id}/evaluations",
            json={"strategy_id": None, "include_public_research": False},
        )
        self.assertEqual(created.status_code, 202)
        evaluation = self.client.get(f"/job-evaluations/{created.json()['id']}")
        self.assertEqual(evaluation.status_code, 200)
        self.assertIn(evaluation.json()["status"], {"completed", "partial_failed"})
        return evaluation.json()

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

    def test_production_preview_origin_is_allowed_by_cors(self) -> None:
        response = self.client.options(
            "/health",
            headers={
                "Origin": "http://127.0.0.1:4173",
                "Access-Control-Request-Method": "GET",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("access-control-allow-origin"),
            "http://127.0.0.1:4173",
        )

    def test_job_projects_exist_without_restoring_legacy_automation_endpoints(self) -> None:
        self.assertIn(self.client.post("/chat/messages", json={"content": "测试"}).status_code, {404, 405})
        self.assertEqual(self.client.get("/candidate-profile").status_code, 404)
        self.assertIn(self.client.put("/candidate-profile", json={}).status_code, {404, 405})
        self.assertEqual(self.client.get("/jobs").status_code, 200)
        self.assertEqual(self.client.post("/jobs", json={}).status_code, 422)
        created = self.client.post(
            "/jobs",
            json={
                "job_title": "AI 产品经理",
                "company_name": "示例科技",
                "description": "负责 Agent 产品规划。\n\n任职要求\n熟悉 Python 与需求分析。",
            },
        )
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["job_title"], "AI 产品经理")
        self.assertIn(self.client.post("/jobs/manual-import", json={}).status_code, {404, 405})
        self.assertIn(self.client.post("/applications", json={}).status_code, {404, 405})
        self.assertEqual(self.client.get("/applications").status_code, 404)
        self.assertIn(self.client.post("/profiles", json={}).status_code, {404, 405})

    def test_job_analysis_api_persists_evidence_report_and_feedback(self) -> None:
        self.seed_confirmed_career_profile(
            name="接口测试用户",
            resume_text="负责 Agent 产品规划和需求分析，使用 Python 完成内部工具。",
            cities=["上海"],
            salary_min=30_000,
        )
        job = create_job(
            {
                "job_title": "AI 产品经理",
                "company_name": "示例科技",
                "location": "上海",
                "description": (
                    "负责 Agent 产品规划和需求分析；"
                    "要求熟悉 Python；要求熟悉 Kubernetes 集群管理。"
                ),
            }
        )
        self.assertEqual(self.client.get(f"/jobs/{job['id']}/evaluations").json(), [])
        analysis = self.create_completed_evaluation(job["id"])
        missing = next(
            item for item in analysis["requirements"] if item["match_status"] == "no_evidence"
        )
        fact_id = self.client.get("/career-profile/facts?status=confirmed").json()[0]["id"]
        feedback = self.client.post(
            f"/job-evaluations/{analysis['id']}/reviews",
            json={"target_type": "requirement", "target_key": missing["requirement_key"], "action": "edit", "override": {"match_status": "partial", "fact_ids": [fact_id]}, "note": "人工复核"},
        )
        self.assertEqual(feedback.status_code, 200)
        effective = next(item for item in feedback.json()["effective_requirements"] if item["requirement_key"] == missing["requirement_key"])
        self.assertEqual(effective["effective_match_status"], "partial")
        self.assertEqual(next(item for item in feedback.json()["requirements"] if item["requirement_key"] == missing["requirement_key"])["match_status"], "no_evidence")

    def test_tailored_resume_version_api_supports_review_and_export(self) -> None:
        self.seed_confirmed_career_profile(
            name="简历版本用户",
            resume_text="负责 Agent 产品规划和需求分析。\n使用 Python 完成内部工具。",
        )
        job = create_job(
            {
                "job_title": "AI 产品经理",
                "company_name": "示例科技",
                "description": (
                    "负责 Agent 产品规划和需求分析；"
                    "要求熟悉 Python；推动产品原型落地。"
                ),
            }
        )
        self.create_completed_evaluation(job["id"])

        created = self.client.post(f"/jobs/{job['id']}/resume-versions")
        self.assertEqual(created.status_code, 200)
        version = created.json()
        self.assertGreaterEqual(len(version["changes"]), 3)
        self.assertEqual(
            self.client.get(f"/jobs/{job['id']}/resume-versions").json()[0]["id"],
            version["id"],
        )

        change = version["changes"][0]
        reviewed = self.client.patch(
            f"/resume-versions/{version['id']}/changes/{change['id']}",
            json={"decision": "accepted"},
        )
        self.assertEqual(reviewed.status_code, 200)
        self.assertEqual(reviewed.json()["change_counts"]["accepted"], 1)
        finalized = self.client.patch(
            f"/resume-versions/{version['id']}",
            json={"status": "final"},
        )
        self.assertEqual(finalized.json()["status"], "final")

        docx = self.client.get(
            f"/resume-versions/{version['id']}/export?format=docx"
        )
        self.assertEqual(docx.status_code, 200)
        self.assertIn("wordprocessingml", docx.headers["content-type"])
        self.assertIn("filename*=UTF-8", docx.headers["content-disposition"])
        pdf = self.client.get(
            f"/resume-versions/{version['id']}/export?format=pdf"
        )
        self.assertEqual(pdf.status_code, 200)
        self.assertTrue(pdf.content.startswith(b"%PDF"))

    def test_interview_workflow_api_persists_kit_rounds_and_timeline(self) -> None:
        self.seed_confirmed_career_profile(
            name="面试测试用户",
            resume_text="负责 Agent 产品规划和需求分析，使用 Python 完成原型。",
        )
        job = create_job(
            {
                "job_title": "AI 产品经理",
                "company_name": "示例科技",
                "description": (
                    "负责 Agent 产品规划和需求分析；"
                    "要求熟悉 Python；推动产品原型落地。"
                ),
            }
        )
        self.create_completed_evaluation(job["id"])
        created = self.client.post(
            f"/jobs/{job['id']}/interview-kits",
            json={"interview_type": "technical"},
        )
        self.assertEqual(created.status_code, 200)
        kit = created.json()
        self.assertTrue(kit["content"]["questions"])
        task = kit["tasks"][0]
        checked = self.client.patch(
            f"/interview-kits/{kit['id']}/tasks/{task['id']}",
            json={"completed": True},
        )
        self.assertEqual(checked.json()["completed_task_count"], 1)

        scheduled = self.client.post(
            f"/jobs/{job['id']}/interview-rounds",
            json={
                "kit_id": kit["id"],
                "round_type": "technical",
                "scheduled_at": "2026-08-01T14:00",
                "interviewer": "技术负责人",
            },
        )
        self.assertEqual(scheduled.status_code, 200)
        interview = scheduled.json()
        self.assertEqual(interview["status"], "scheduled")
        result = self.client.patch(
            f"/interview-rounds/{interview['id']}",
            json={"status": "completed", "outcome": "passed", "notes": "进入终面"},
        )
        self.assertEqual(result.json()["outcome"], "passed")
        timeline = self.client.get(f"/jobs/{job['id']}/timeline").json()
        event_types = {item["event_type"] for item in timeline}
        self.assertIn("interview_kit_created", event_types)
        self.assertIn("interview_scheduled", event_types)
        self.assertIn("interview_result", event_types)

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

    def test_ag_ui_reports_waiting_user_via_state_snapshot(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "AG-UI 等待用户"}).json()

        class WaitingRuntime:
            async def run_stream(self, *args, **kwargs):
                yield AgentStreamEvent(
                    type="completed",
                    result=AgentRunResult(
                        content="请确认是否继续该操作。",
                        provider="openai",
                        platform="manual",
                        rounds=1,
                        status="waiting_user",
                    ),
                )

        original_get_agent_runtime = main_module.get_agent_runtime
        main_module.get_agent_runtime = lambda: WaitingRuntime()
        try:
            events = self.run_ag_ui(conversation["id"], "确认这份岗位评估", "run-waiting-user")
        finally:
            main_module.get_agent_runtime = original_get_agent_runtime

        event_types = [event["type"] for event in events]
        self.assertEqual(event_types[-1], "RUN_FINISHED")
        self.assertNotIn("RUN_ERROR", event_types)
        snapshot = next(event["snapshot"] for event in events if event["type"] == "STATE_SNAPSHOT")
        self.assertEqual(snapshot["bossCopilot"]["status"], "waiting_user")
        self.assertEqual(
            snapshot["bossCopilot"]["assistantMessage"]["payload"]["agent"]["status"],
            "waiting_user",
        )

    def test_external_platform_request_reaches_agent_runtime(self) -> None:
        conversation = self.client.post("/conversations", json={"title": "平台能力测试"}).json()
        received: list[str] = []

        class PlatformAwareRuntime:
            async def run_stream(self, content, *args, **kwargs):
                received.append(content)
                yield AgentStreamEvent(type="text_delta", delta="正在按当前可用能力处理。")
                yield AgentStreamEvent(
                    type="completed",
                    result=AgentRunResult(
                        content="正在按当前可用能力处理。",
                        provider="openai",
                        platform="manual",
                        rounds=1,
                        status="done",
                    ),
                )

        original_get_agent_runtime = main_module.get_agent_runtime
        main_module.get_agent_runtime = lambda: PlatformAwareRuntime()
        try:
            events = self.run_ag_ui(
                conversation["id"],
                "帮我打开并登录 BOSS",
                "run-external-platform",
            )
        finally:
            main_module.get_agent_runtime = original_get_agent_runtime

        self.assertEqual(received, ["帮我打开并登录 BOSS"])
        text = "".join(
            event["delta"] for event in events if event["type"] == "TEXT_MESSAGE_CONTENT"
        )
        self.assertEqual(text, "正在按当前可用能力处理。")

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

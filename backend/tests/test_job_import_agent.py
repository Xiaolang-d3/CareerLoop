from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.jobs.import_agent import JobImportAgent
from app.jobs.imports import JobImportError, preview_job_url
from app.jobs.page_ai import JobImportAIError, JobImportModelAction
from app.research.web import WebResearchError


class FakeModel:
    def __init__(self, actions: list[tuple[str, dict]] | None = None, error: str = "") -> None:
        self.actions = list(actions or [])
        self.error = error
        self.calls = 0

    def next_action(self, *, messages, tools):
        del messages
        self.calls += 1
        if self.error:
            raise JobImportAIError(self.error)
        name, arguments = self.actions.pop(0)
        available = {tool["function"]["name"] for tool in tools}
        assert name in available, f"{name} not in {available}"
        call_id = f"call-{self.calls}"
        return JobImportModelAction(
            tool_call_id=call_id,
            tool_name=name,
            arguments=arguments,
            assistant_message={
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": "{}",
                        },
                    }
                ],
            },
        )


READY_HTML = """
<html>
  <head><title>高级产品经理招聘</title></head>
  <body>
    <div>公司名称：示例科技</div>
    <div>工作地点：上海</div>
    <h2>职位描述</h2>
    <p>负责企业级 AI 产品规划、客户研究、需求分析以及商业化落地。</p>
    <p>任职要求：五年以上产品经验，能够独立推进复杂项目交付。</p>
    <footer>公司介绍</footer>
  </body>
</html>
"""


class JobImportAgentTest(unittest.TestCase):
    def test_agent_chooses_static_fetch_extract_and_finish(self) -> None:
        events = []
        model = FakeModel(
            [
                ("inspect_job_url", {}),
                ("fetch_public_page", {}),
                ("extract_job_fields", {}),
                ("finish_job_import", {}),
            ]
        )
        agent = JobImportAgent(
            model=model,
            fetcher=lambda url: (url, READY_HTML),
            renderer=lambda url: {},
            event_callback=events.append,
        )

        with patch("app.jobs.imports.is_public_source_url", return_value=True):
            result = agent.run("https://jobs.example.com/job/123")

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["decision_source"], "agent")
        self.assertEqual(result["requested_page_type"], "job_detail")
        self.assertEqual(result["agent_rounds"], 4)
        self.assertEqual(
            [event["tool"] for event in result["agent_trace"]],
            [
                "inspect_job_url",
                "fetch_public_page",
                "extract_job_fields",
                "finish_job_import",
            ],
        )
        self.assertEqual(events[0]["type"], "started")
        self.assertTrue(any(event["type"] == "thinking" for event in events))
        self.assertTrue(
            any(event["type"] == "task" and event["status"] == "running" for event in events)
        )
        self.assertEqual(events[-1]["type"], "completed")

    def test_agent_can_recover_from_login_redirect_with_browser_render(self) -> None:
        model = FakeModel(
            [
                ("inspect_job_url", {}),
                ("fetch_public_page", {}),
                ("render_public_page", {}),
                ("extract_job_fields", {}),
                ("finish_job_import", {}),
            ]
        )
        login_html = """
        <html><head><title>登录 - BOSS直聘</title></head>
        <body>请登录后查看职位详情。</body></html>
        """
        rendered = {
            "success": True,
            "final_url": "https://www.zhipin.com/job_detail/abc.html",
            "title": "高级产品经理",
            "content": (
                "公司名称：示例科技\n工作地点：上海\n职位描述\n"
                "负责企业级 AI 产品规划、用户研究、需求分析与商业化落地。\n"
                "任职要求：五年以上产品经验，能够独立推进复杂项目交付。"
            ),
            "challenge_detected": False,
        }
        agent = JobImportAgent(
            model=model,
            fetcher=lambda url: ("https://www.zhipin.com/login", login_html),
            renderer=lambda url: rendered,
        )

        with patch("app.jobs.imports.is_public_source_url", return_value=True):
            result = agent.run("https://www.zhipin.com/job_detail/abc.html")

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["platform"], "boss")
        self.assertEqual(result["requested_page_type"], "job_detail")
        self.assertEqual(result["fetch_page_type"], "unknown")
        self.assertIn("render_public_page", [event["tool"] for event in result["agent_trace"]])

    def test_agent_stops_known_job_list_before_fetching(self) -> None:
        model = FakeModel(
            [
                ("inspect_job_url", {}),
                (
                    "stop_job_import",
                    {
                        "page_type": "job_list",
                        "reason": "链接路径属于岗位列表，不是单个岗位详情",
                        "confidence": 0.96,
                    },
                ),
            ]
        )
        fetch_calls = []
        agent = JobImportAgent(
            model=model,
            fetcher=lambda url: fetch_calls.append(url),
            renderer=lambda url: {},
        )

        with patch("app.jobs.imports.is_public_source_url", return_value=True):
            result = agent.run("https://www.zhipin.com/web/geek/job")

        self.assertEqual(result["status"], "unsupported")
        self.assertEqual(result["page_type"], "job_list")
        self.assertEqual(fetch_calls, [])

    def test_agent_requests_browser_capture_before_extension_handshake(
        self,
    ) -> None:
        model = FakeModel(
            [
                ("inspect_job_url", {}),
                ("fetch_public_page", {}),
                ("render_public_page", {}),
                (
                    "stop_job_import",
                    {
                        "page_type": "captcha",
                        "reason": "页面触发安全验证",
                        "confidence": 0.99,
                    },
                ),
            ]
        )
        security_html = (
            "<html><head><title>安全验证</title></head>"
            "<body>请完成安全验证</body></html>"
        )
        agent = JobImportAgent(
            model=model,
            fetcher=lambda url: (
                "https://www.zhipin.com/web/passport/zp/security.html",
                security_html,
            ),
            renderer=lambda url: {
                "success": True,
                "final_url": "https://www.zhipin.com/web/passport/zp/security.html",
                "title": "安全验证",
                "content": "请完成安全验证",
                "challenge_detected": True,
            },
        )

        with patch("app.jobs.imports.is_public_source_url", return_value=True):
            result = agent.run("https://www.zhipin.com/job_detail/abc.html")

        self.assertEqual(result["status"], "browser_required")
        self.assertEqual(result["page_type"], "captcha")
        self.assertIn("需要连接 Chrome 浏览器助手", result["stop_reason"])
        self.assertEqual(result["agent_trace"][-1]["tool"], "request_browser_capture")

    def test_model_timeout_after_blocked_static_page_requests_browser(self) -> None:
        class TimeoutAfterStaticModel(FakeModel):
            def next_action(self, *, messages, tools):
                if self.calls >= 2:
                    raise JobImportAIError("岗位导入智能体响应超时，请稍后重试")
                return super().next_action(messages=messages, tools=tools)

        model = TimeoutAfterStaticModel(
            [
                ("inspect_job_url", {}),
                ("fetch_public_page", {}),
            ]
        )
        security_html = (
            "<html><head><title>安全验证</title></head>"
            "<body>请完成安全验证</body></html>"
        )
        agent = JobImportAgent(
            model=model,
            fetcher=lambda url: (
                "https://www.zhipin.com/web/passport/zp/security.html",
                security_html,
            ),
        )

        with patch("app.jobs.imports.is_public_source_url", return_value=True):
            result = agent.run("https://www.zhipin.com/job_detail/abc.html")

        self.assertEqual(result["status"], "browser_required")
        self.assertEqual(result["decision_source"], "agent_fallback")
        self.assertEqual(result["page_type"], "captcha")
        self.assertEqual(result["agent_trace"][-1]["tool"], "request_browser_capture")
        self.assertNotIn("响应超时", result["stop_reason"])

    def test_first_model_timeout_on_boss_job_uses_safe_fallback(self) -> None:
        security_html = (
            "<html><head><title>安全验证</title></head>"
            "<body>请完成安全验证</body></html>"
        )
        agent = JobImportAgent(
            model=FakeModel(error="岗位导入智能体响应超时，请稍后重试"),
            fetcher=lambda url: (
                "https://www.zhipin.com/web/passport/zp/security.html",
                security_html,
            ),
        )

        with patch("app.jobs.imports.is_public_source_url", return_value=True):
            result = agent.run("https://www.zhipin.com/job_detail/abc.html")

        self.assertEqual(result["status"], "browser_required")
        self.assertEqual(result["platform"], "boss")
        self.assertEqual(result["requested_page_type"], "job_detail")
        self.assertEqual(result["page_type"], "captcha")
        self.assertEqual(result["decision_source"], "agent_fallback")
        self.assertEqual(result["agent_trace"][-1]["tool"], "request_browser_capture")

    def test_agent_extracts_fields_from_valid_browser_capture(self) -> None:
        model = FakeModel(
            [
                ("extract_job_fields", {}),
                ("finish_job_import", {}),
            ]
        )
        capture = {
            "schema_version": "browser-job-capture-v1",
            "capture_id": "capture-1234567890",
            "requested_url": "https://www.zhipin.com/job_detail/abc.html",
            "final_url": "https://www.zhipin.com/job_detail/abc.html",
            "platform": "boss",
            "page_type": "job_detail",
            "title": "AI 智能体应用开发工程师",
            "visible_text": "职位描述\n负责智能体平台开发与系统集成。",
            "hints": {
                "job_title": "AI 智能体应用开发工程师",
                "company_name": "示例科技",
                "location": "上海",
                "salary_text": "15-30K",
                "description": (
                    "负责端云智能体系统的架构设计与开发；"
                    "负责大模型 Agent 的模型选择、数据准备、决策逻辑和系统集成。"
                ),
            },
            "captured_at": datetime.now(UTC).isoformat(),
            "truncated": False,
        }
        agent = JobImportAgent(model=model)

        with patch("app.jobs.imports.is_public_source_url", return_value=True):
            result = agent.run_browser_capture(capture)

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["job_title"], "AI 智能体应用开发工程师")
        self.assertEqual(result["company_name"], "示例科技")
        self.assertEqual(result["fetch_page_type"], "job_detail")
        self.assertEqual(result["agent_trace"][0]["tool"], "inspect_browser_capture")
        self.assertEqual(result["agent_rounds"], 1)
        self.assertEqual(model.calls, 0)

    def test_quality_gate_rejects_login_page_even_if_model_tries_to_finish(self) -> None:
        model = FakeModel(
            [
                ("inspect_job_url", {}),
                ("fetch_public_page", {}),
                ("extract_job_fields", {}),
                ("finish_job_import", {}),
                (
                    "stop_job_import",
                    {
                        "page_type": "login_required",
                        "reason": "实际页面要求登录，无法取得公开岗位正文",
                        "confidence": 0.99,
                    },
                ),
            ]
        )
        login_html = """
        <html><head><title>登录 - 招聘平台</title></head>
        <body><h2>职位描述</h2>
        <p>请登录后查看完整职位描述、岗位职责、任职要求和招聘公司信息。</p>
        </body></html>
        """
        agent = JobImportAgent(
            model=model,
            fetcher=lambda url: ("https://jobs.example.com/login", login_html),
            renderer=lambda url: {},
        )

        with patch("app.jobs.imports.is_public_source_url", return_value=True):
            result = agent.run("https://jobs.example.com/job/123")

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["page_type"], "login_required")
        self.assertEqual(result["stop_reason"], "页面需要登录，未能读取岗位内容。")

    def test_fetch_and_browser_failures_remain_observations_for_the_agent(self) -> None:
        model = FakeModel(
            [
                ("inspect_job_url", {}),
                ("fetch_public_page", {}),
                ("render_public_page", {}),
                (
                    "stop_job_import",
                    {
                        "page_type": "unknown",
                        "reason": "两种读取策略都没有取得正文",
                        "confidence": 0.95,
                    },
                ),
            ]
        )

        def fail_fetch(url):
            raise JobImportError("静态访问被拒绝")

        def fail_render(url):
            raise WebResearchError("agent_search_unavailable", "浏览器服务未启动")

        agent = JobImportAgent(
            model=model,
            fetcher=fail_fetch,
            renderer=fail_render,
        )

        with patch("app.jobs.imports.is_public_source_url", return_value=True):
            result = agent.run("https://jobs.example.com/job/123")

        self.assertEqual(result["status"], "unsupported")
        self.assertEqual(result["agent_rounds"], 4)
        self.assertEqual(result["agent_trace"][1]["status"], "observed")
        self.assertEqual(result["agent_trace"][2]["status"], "observed")

    def test_model_failure_returns_structured_stop_result(self) -> None:
        agent = JobImportAgent(model=FakeModel(error="模型服务超时"))

        result = agent.run("https://jobs.example.com/job/123")

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["decision_source"], "agent_error")
        self.assertIn("模型服务超时", result["stop_reason"])

    def test_preview_endpoint_helper_delegates_to_agent(self) -> None:
        class FakeAgent:
            def run(self, url):
                return {"source_url": url, "status": "blocked"}

        result = preview_job_url("https://example.com/job/1", agent=FakeAgent())

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["source_url"], "https://example.com/job/1")

    def test_stream_endpoint_emits_activity_before_result(self) -> None:
        class FakeStreamingAgent:
            def __init__(self, *, event_callback):
                self.event_callback = event_callback

            def run(self, url):
                self.event_callback(
                    {
                        "type": "thinking",
                        "id": "thinking-1",
                        "round": 1,
                        "status": "thinking",
                        "message": "正在选择下一步",
                    }
                )
                return {
                    "status": "blocked",
                    "source_url": url,
                    "stop_reason": "测试停止",
                }

        with (
            patch("app.api.resources.JobImportAgent", FakeStreamingAgent),
            patch("app.main.current_user", return_value={"id": 1, "email": "test@example.com"}),
        ):
            response = TestClient(app).post(
                "/job-imports/preview/stream",
                json={"url": "https://example.com/job/1"},
            )

        self.assertEqual(response.status_code, 200)
        events = [json.loads(line) for line in response.text.splitlines() if line]
        self.assertEqual(events[0]["type"], "thinking")
        self.assertEqual(events[-1]["type"], "result")
        self.assertEqual(events[-1]["preview"]["stop_reason"], "测试停止")

    def test_browser_capture_stream_endpoint_runs_second_agent_stage(self) -> None:
        class FakeBrowserAgent:
            def __init__(self, *, event_callback):
                self.event_callback = event_callback

            def run_browser_capture(self, payload):
                self.event_callback(
                    {
                        "type": "task",
                        "id": "browser-validate",
                        "round": 1,
                        "tool": "inspect_browser_capture",
                        "status": "done",
                        "message": "浏览器页面验证完成",
                    }
                )
                return {
                    "status": "ready",
                    "source_url": payload["requested_url"],
                    "stop_reason": "",
                }

        payload = {
            "schema_version": "browser-job-capture-v1",
            "capture_id": "capture-1234567890",
            "requested_url": "https://www.zhipin.com/job_detail/abc.html",
            "final_url": "https://www.zhipin.com/job_detail/abc.html",
            "platform": "boss",
            "page_type": "job_detail",
            "title": "AI 智能体应用开发工程师",
            "visible_text": "职位描述\n负责大模型智能体系统架构设计、开发、测试和系统集成。",
            "hints": {
                "job_title": "AI 智能体应用开发工程师",
                "company_name": "示例科技",
                "location": "上海",
                "salary_text": "15-30K",
                "description": "负责大模型智能体系统架构设计、开发、测试和系统集成。",
            },
            "captured_at": datetime.now(UTC).isoformat(),
            "truncated": False,
        }
        with (
            patch("app.api.resources.JobImportAgent", FakeBrowserAgent),
            patch(
                "app.api.resources.get_settings",
                return_value=SimpleNamespace(browser_job_import_enabled=True),
            ),
            patch("app.main.current_user", return_value={"id": 1, "email": "test@example.com"}),
        ):
            response = TestClient(app).post(
                "/job-imports/browser-preview/stream",
                json=payload,
            )

        self.assertEqual(response.status_code, 200)
        events = [json.loads(line) for line in response.text.splitlines() if line]
        self.assertEqual(events[0]["tool"], "inspect_browser_capture")
        self.assertEqual(events[-1]["type"], "result")
        self.assertEqual(events[-1]["preview"]["status"], "ready")


if __name__ == "__main__":
    unittest.main()

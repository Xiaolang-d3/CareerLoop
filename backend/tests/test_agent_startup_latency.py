"""Startup work is bounded and reports its real phase before it finishes."""
from __future__ import annotations

import asyncio
import pytest

from app.domain import ModelResponse, ToolCall
from app.models import ModelProviderError
from app.models.configured import ConfiguredModelProvider
from test_agent_runtime import CountingTool, ScriptedModel, runtime_for


INTENT = ModelResponse(content='{"kind":"conversation","sources":[],"needs_planning":false}')


def test_classification_is_lightweight_without_changing_answer_preferences():
    async def scenario():
        raw = ScriptedModel([INTENT, ModelResponse(content="正式回答")])
        provider = ConfiguredModelProvider(raw, {"temperature": 0.4, "max_output_tokens": 8192}, "high")
        result = await runtime_for(provider).run("解释一下事件循环")
        assert result.status == "done" and len(raw.requests) == 2
        classification, answer = raw.requests
        assert classification.reasoning_effort == "low"
        assert classification.parameters == {"temperature": 0.4, "max_output_tokens": 1024}
        assert classification.tools == [] and classification.tool_choice == "none"
        assert answer.reasoning_effort == "high"
        assert answer.parameters == {"temperature": 0.4, "max_output_tokens": 8192}
    asyncio.run(scenario())


@pytest.mark.parametrize("phase", ["classify", "plan"])
def test_reports_the_phase_while_the_provider_is_still_working(phase):
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        responses = [INTENT, ModelResponse(content="已回答")]
        gated_call = 0
        if phase == "plan":
            gated_call = 1
            responses = [
                ModelResponse(content='{"kind":"content_creation","sources":["public_web"],"needs_planning":true}'),
                ModelResponse(content='{"goal":"核对公开资料","steps":[{"tool_name":"search_public_web","title":"检索公开资料"}]}'),
                ModelResponse(tool_calls=[ToolCall(id="search", name="search_public_web", arguments={"query":"公开资料"})]),
                ModelResponse(content="已整理。[来源](https://example.com/source)"),
            ]
        class Gated(ScriptedModel):
            async def generate(self, request):
                if len(self.requests) == gated_call:
                    entered.set()
                    await release.wait()
                return await super().generate(request)
        model, captured = Gated(responses), []
        async def capture(event):
            if event.type == "agent_event":
                captured.append(event.event)
        task = asyncio.create_task(runtime_for(model, CountingTool("search_public_web")).run("帮我理解这件事情", event_callback=capture))
        await asyncio.wait_for(entered.wait(), 1)
        active = next(event for event in captured if event.tool_call_id == f"model-stage-{phase}")
        assert active.status == "running" and active.started_at
        assert active.message == ("正在理解你的请求" if phase == "classify" else "正在规划步骤")
        release.set()
        result = await task
        finished = [event for event in captured if event.tool_call_id == active.tool_call_id][-1]
        assert finished.status == "done" and finished.duration_ms is not None
        assert not any(event.tool_name == "agent_run_state" for event in result.events)
        assert result.status == "done"
    asyncio.run(scenario())


def test_failed_classification_ends_the_phase_before_using_existing_route_fallback():
    async def scenario():
        captured = []
        async def capture(event):
            if event.type == "agent_event" and event.event.tool_name == "agent_run_state":
                captured.append(event.event)
        model = ScriptedModel([ModelProviderError("service_unavailable", "分类暂不可用"), ModelResponse(content="直接回答")])
        result = await runtime_for(model).run("解释一下事件循环", event_callback=capture)
        assert result.status == "done"
        assert [event.status for event in captured] == ["running", "failed"]
    asyncio.run(scenario())


def test_simple_greetings_keep_the_single_call_fast_path():
    async def scenario():
        model = ScriptedModel([ModelResponse(content="你好")])
        assert (await runtime_for(model).run("你好")).status == "done"
        assert len(model.requests) == 1 and model.requests[0].reasoning_effort is None
    asyncio.run(scenario())

from __future__ import annotations

import asyncio
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import pytest

from app.agent import bootstrap
from app.agent.model_binding import internal_model_selection
from app.agent.runtime import AgentRuntime
from app.agent.run_store import AgentRunStore
from app.db import connect, init_db
from app.domain import AgentMessage, AgentRunResult, AgentRunSnapshot, ModelResponse, ToolCall
from app.models import ModelProviderError, ModelProviderRegistry
from app.observability.model_context import current_model_call, public_model_selection
from app.tools import AskUserTool, ToolRegistry


def connection(profile_id="profile-one", revision=1):
    return {
        "profile_id": profile_id, "profile_revision": revision,
        "connection_id": "connection-one", "connection_revision": 1,
        "model_name": "test-model", "model_base_url": "https://model.example.test/v1",
        "model_protocol": "openai", "resolved_model_protocol": "openai",
        "api_key": "fake-test-key", "secret_ref": "memory:test-reference",
        "parameters": {"api_key": "should-never-persist"},
    }


class RecordingModel:
    name = "openai"

    def __init__(self, fail_once=False):
        self.contexts = []
        self.fail_once = fail_once

    async def generate(self, request):
        self.contexts.append(current_model_call())
        await asyncio.sleep(0)
        if self.fail_once and len(self.contexts) == 1:
            raise ModelProviderError("temporary", "临时失败", retryable=True)
        return ModelResponse(content="测试回答")


def runtime_for(model, selection=None, run_store=None):
    selection = selection or connection()
    models = ModelProviderRegistry()
    models.register(selection["profile_id"], model)
    tools = ToolRegistry()
    tools.register_handler(AskUserTool())
    return AgentRuntime(
        models=models, tools=tools, model_provider=selection["profile_id"],
        platform_name="manual", max_tool_rounds=3, max_model_retries=1,
        model_selection=selection, run_store=run_store,
    )


class AgentModelBindingTest(unittest.IsolatedAsyncioTestCase):
    async def test_retry_uses_one_binding_with_unique_call_identity(self):
        model = RecordingModel(fail_once=True)
        runtime = runtime_for(model)
        result = await runtime.run("你好", run_id="bound-retry")
        assert result.status == "done"
        assert result.model_selection["profile_id"] == "profile-one"
        assert "api_key" not in result.model_selection
        assert "parameters" not in result.model_selection
        assert len(model.contexts) == 2
        assert all(item["run_id"] == "bound-retry" and item["stage"] == "execute" for item in model.contexts)
        assert len({item["call_id"] for item in model.contexts}) == 2
        assert all(item["profile_revision"] == 1 for item in model.contexts)
        assert current_model_call() == {}


    async def test_changed_runtime_cannot_resume_a_bound_old_version(self):
        model = RecordingModel()
        runtime = runtime_for(model, connection(revision=2))
        snapshot = AgentRunSnapshot(
            route_kind="conversation", needs_plan=False,
            messages=[AgentMessage(role="user", content="你好")],
            model_selection=internal_model_selection(connection(revision=1)),
        )
        with pytest.raises(ModelProviderError, match="原配置版本") as failure:
            await runtime.run("继续", resume=snapshot)
        assert failure.value.code == "model_selection_unavailable"
        assert model.contexts == []


    async def test_legacy_checkpoint_is_explicitly_unbound(self):
        model = RecordingModel()
        snapshot = AgentRunSnapshot(
            resume_mode="checkpoint", route_kind="conversation", needs_plan=False,
            messages=[AgentMessage(role="user", content="你好")],
        )
        result = await runtime_for(model).run("继续", resume=snapshot)
        assert result.status == "done"
        assert result.model_selection == {"selection_reason": "legacy_unbound"}
        assert model.contexts[0]["profile_id"] == ""


    async def test_concurrent_runs_keep_scope_identities_separate(self):
        model = RecordingModel()
        runtime = runtime_for(model)
        first, second = await asyncio.gather(
            runtime.run("你好", run_id="first-run"), runtime.run("你好", run_id="second-run"),
        )
        assert first.model_selection == second.model_selection
        assert {item["run_id"] for item in model.contexts} == {"first-run", "second-run"}
        assert len({item["call_id"] for item in model.contexts}) == 2

    async def test_waiting_snapshot_preserves_bound_identity(self):
        class AskingModel(RecordingModel):
            async def generate(self, request):
                return ModelResponse(tool_calls=[ToolCall(
                    id="ask-one", name="ask_user",
                    arguments={"question": "选择方向", "options": [{"label": "总结"}, {"label": "改写"}]},
                )])

        result = await runtime_for(AskingModel()).run("你好")
        assert result.status == "waiting_user"
        assert result.snapshot.model_selection == result.model_selection
        assert result.snapshot.model_selection["profile_revision"] == 1
        assert "api_key" not in result.snapshot.model_dump_json()



def test_same_protocol_profiles_have_stable_independent_aliases():
    profiles = {name: connection(name) for name in ("profile-one", "profile-two")}
    bootstrap.reload_agent_components()
    with patch.object(bootstrap, "get_profile_connection", side_effect=lambda profile_id=None, **kwargs: profiles[profile_id]), patch.object(bootstrap, "build_model_provider", side_effect=lambda **kwargs: RecordingModel()):
        first = bootstrap.get_agent_runtime("profile-one")
        second = bootstrap.get_agent_runtime("profile-two")
        assert first is bootstrap.get_agent_runtime("profile-one")
    assert first is not second
    assert first._models.names() == ["profile-one"]
    assert second._models.names() == ["profile-two"]
    bootstrap.reload_agent_components()


def test_restore_resolves_historical_identity_once():
    stored = internal_model_selection(connection(revision=1))
    bootstrap.reload_agent_components()
    with patch.object(bootstrap, "get_profile_connection", return_value=connection(revision=1)) as resolve, patch.object(bootstrap, "build_model_provider", return_value=RecordingModel()):
        runtime = bootstrap.get_agent_runtime(selection=stored)
    resolve.assert_called_once_with(None, selection=stored)
    assert runtime.model_selection["profile_revision"] == 1
    bootstrap.reload_agent_components()


def test_internal_and_public_bindings_remove_credentials_recursively():
    source = connection()
    source["stage_selections"] = {"execute": deepcopy(source)}
    internal = internal_model_selection(source)
    public = public_model_selection(internal)
    assert "api_key" not in str(internal)
    assert "secret_ref" in str(internal)
    assert "secret_ref" not in str(public)
    assert "parameters" not in str(public)


def test_run_binding_is_persisted_before_call_and_replayed_after_default_change(tmp_path: Path):
    db_path = tmp_path / "bound-runs.db"
    init_db(db_path)
    store = AgentRunStore(db_path)

    class BoundModel(RecordingModel):
        async def generate(self, request):
            assert store.get_run("bound-run")["model_selection"]["profile_revision"] == 1
            return await super().generate(request)

    original = BoundModel()
    first_runtime = runtime_for(original, run_store=store)
    changed = RecordingModel()
    changed_runtime = runtime_for(changed, connection(revision=2), run_store=store)

    async def collect(runtime):
        return [event async for event in runtime.run_stream("你好", run_id="bound-run")]

    first = asyncio.run(collect(first_runtime))
    second = asyncio.run(collect(changed_runtime))
    assert first[-1].result.model_selection == second[-1].result.model_selection
    assert second[-1].result.model_selection["profile_revision"] == 1
    assert changed.contexts == []


def test_interrupted_run_retains_original_input_and_binding_without_checkpoint(tmp_path: Path):
    db_path = tmp_path / "interrupted-runs.db"
    init_db(db_path)
    store = AgentRunStore(db_path)
    store.start_run("interrupted", conversation_id=None, task_id=None,
                    user_content="原始问题", model_selection=connection())
    store.interrupt_active_runs()

    class InputModel(RecordingModel):
        async def generate(self, request):
            contents = [str(message.content) for message in request.messages]
            assert any("原始问题" in content for content in contents)
            assert not any("错误的新问题" in content for content in contents)
            return await super().generate(request)

    async def collect():
        return [event async for event in runtime_for(InputModel(), run_store=store).run_stream(
            "错误的新问题", run_id="interrupted",
        )]

    result = asyncio.run(collect())[-1].result
    assert result.status == "done"
    assert result.model_selection["profile_revision"] == 1


def test_run_store_never_persists_raw_credentials_and_rejects_rebinding(tmp_path: Path):
    db_path = tmp_path / "credentials.db"
    init_db(db_path)
    store = AgentRunStore(db_path)
    store.start_run("identity", conversation_id=None, task_id=None,
                    user_content="你好", model_selection=connection())
    with pytest.raises(ValueError, match="不能重新选择"):
        store.start_run("identity", conversation_id=None, task_id=None,
                        user_content="你好", model_selection=connection(revision=2))
    snapshot = AgentRunSnapshot(route_kind="conversation", needs_plan=False, model_selection=connection())
    store.checkpoint("identity", snapshot)
    store.finish("identity", AgentRunResult(
        content="回答", provider="test", platform="manual", rounds=1,
        model_selection=connection(), snapshot=snapshot,
    ))
    with connect(db_path) as conn:
        row = dict(conn.execute("SELECT * FROM agent_execution_runs WHERE run_id='identity'").fetchone())
    assert "fake-test-key" not in str(row)
    assert "should-never-persist" not in str(row)
    assert "secret_ref" in str(row)

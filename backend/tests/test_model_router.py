"""Stage routing stays deterministic and never widens tool permissions."""
import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app import db, secret_store
from app.agent import bootstrap, settings
from app.agent.model_binding import internal_model_selection
from app.agent.model_catalog import add_model_profile, get_profile_connection, update_model_profile
from app.agent.model_router import ModelRouter, bind_model_stages, get_routing_policy, save_routing_policy
from app.agent.orchestration import TaskRoute
from app.db import init_db
from app.domain import AgentMessage, ModelRequest, ModelResponse, ToolDefinition
from app.models import ModelProviderError
from app.observability.model_context import current_model_call


@pytest.fixture
def catalog(tmp_path, monkeypatch):
    path = tmp_path / "routing.db"
    monkeypatch.setattr(db, "DB_PATH", path)
    monkeypatch.setattr(secret_store, "_MEMORY_SECRETS", {})
    config = SimpleNamespace(model_name="default", model_base_url="https://test.example.test/v1", model_protocol="openai", openai_api_key="synthetic-key")
    monkeypatch.setattr(settings, "get_settings", lambda: config)
    init_db(path)
    default = get_profile_connection(db_path=path)
    profiles = {"default": default}
    for stage in ("classify", "plan", "execute", "explicit"):
        added = add_model_profile({"connection_id": default["connection_id"], "model_name": stage}, path)
        profiles[stage] = get_profile_connection(added["id"], path)
    yield path, profiles
    bootstrap.reload_agent_components()


def policy_for(profiles):
    return {"version": 1, "roles": {stage: profiles[stage]["profile_id"] for stage in ("classify", "plan", "execute")}, "strict_capabilities": False}


def resolve_in(path):
    return lambda profile_id=None, **kwargs: get_profile_connection(profile_id, db_path=path, **kwargs)


def bind(profiles, path, explicit=False):
    return bind_model_stages(profiles["explicit" if explicit else "default"], explicit_profile=explicit, selection=None, resolve=resolve_in(path), policy=policy_for(profiles))


def test_role_priority_and_explicit_execute_override(catalog):
    path, profiles = catalog
    routed = bind(profiles, path)
    assert {stage: value["model_name"] for stage, value in routed["stage_connections"].items()} == {stage: stage for stage in ("classify", "plan", "execute")}
    assert routed["selection_reason"] == "stage_role"
    explicit = bind(profiles, path, True)
    assert explicit["model_name"] == "explicit"
    assert explicit["stage_selections"]["execute"]["selection_reason"] == "explicit_profile"
    assert explicit["stage_selections"]["plan"]["model_name"] == "plan"


def test_unconfigured_roles_inherit_default_not_explicit_execute(catalog):
    path, profiles = catalog
    routed = bind_model_stages(profiles["explicit"], explicit_profile=True, selection=None, resolve=resolve_in(path), policy={"roles": {}, "version": 1, "strict_capabilities": False})
    assert routed["stage_selections"]["classify"]["model_name"] == "default"
    assert routed["stage_selections"]["plan"]["model_name"] == "default"
    assert routed["stage_selections"]["execute"]["model_name"] == "explicit"


def test_resume_uses_fixed_roles_versions_and_policy(catalog):
    path, profiles = catalog
    bound = bind(profiles, path)
    selection = internal_model_selection(bound)
    update_model_profile(profiles["plan"]["profile_id"], {"model_name": "changed-plan"}, path)
    restored = bind_model_stages(get_profile_connection(db_path=path, selection=selection), explicit_profile=False, selection=selection, resolve=resolve_in(path), policy={"version": 99, "roles": {}, "strict_capabilities": True})
    assert restored["policy_version"] == 1 and restored["strict_capabilities"] is False
    assert restored["stage_selections"]["plan"]["model_name"] == "plan"
    assert restored["stage_selections"]["plan"]["profile_revision"] == 1
    assert "synthetic-key" not in str(selection)


@pytest.mark.parametrize("damage", ["missing", "different_execute", "incomplete"])
def test_damaged_bindings_never_use_current_policy(catalog, damage):
    path, profiles = catalog
    bound = bind(profiles, path)
    selection = internal_model_selection(bound)
    if damage == "missing":
        selection["stage_selections"].pop("plan")
    elif damage == "different_execute":
        selection["stage_selections"]["execute"] = internal_model_selection(profiles["explicit"])
    else:
        selection["stage_selections"]["plan"] = {}
    with pytest.raises(ValueError, match="绑定"):
        bind_model_stages(bound, explicit_profile=False, selection=selection, resolve=resolve_in(path))


def test_legacy_run_keeps_original_single_provider(catalog):
    path, profiles = catalog
    selection = internal_model_selection(profiles["explicit"])
    restored = bind_model_stages(profiles["explicit"], explicit_profile=False, selection=selection, resolve=lambda **kwargs: pytest.fail("legacy must not resolve new stages"), policy=policy_for(profiles))
    assert "stage_connections" not in restored
    assert restored["model_name"] == "explicit"


def test_policy_cas_and_rejects_disabled_and_foreign_profiles(catalog):
    path, profiles = catalog
    first = get_routing_policy(path)
    saved = save_routing_policy({"roles": {"plan": profiles["plan"]["profile_id"]}, "strict_capabilities": True, "expected_version": first["version"]}, path)
    assert saved["version"] == first["version"] + 1
    with pytest.raises(settings.AgentSettingsConflict):
        save_routing_policy({"roles": {}, "expected_version": first["version"]}, path)
    with pytest.raises(ValueError, match="不存在"):
        save_routing_policy({"roles": {"plan": "foreign"}, "expected_version": saved["version"]}, path)
    update_model_profile(profiles["plan"]["profile_id"], {"enabled": False}, path)
    with pytest.raises(ValueError, match="停用"):
        save_routing_policy({"roles": {"plan": profiles["plan"]["profile_id"]}, "expected_version": saved["version"]}, path)
    assert get_routing_policy(path) == saved


def request_for(capability):
    if capability == "vision":
        return ModelRequest(messages=[AgentMessage(role="user", content="hi", payload={"image_urls": ["data:image/png;base64,fake"]})])
    if capability == "tools":
        return ModelRequest(messages=[], tools=[ToolDefinition(name="allowed", description="allowed", input_schema={"type": "object"})])
    return ModelRequest(messages=[])


@pytest.mark.parametrize("capability", ["vision", "tools", "streaming"])
@pytest.mark.parametrize("status,strict,blocked", [("unknown", False, False), ("unknown", True, True), ("unsupported", False, True), ("supported", True, False)])
def test_capabilities_and_unknown_are_distinct(capability, status, strict, blocked):
    connection = {"capabilities": {capability: status}, "profile_id": "p", "connection_id": "c", "profile_revision": 1, "connection_revision": 1}
    provider = object()
    router = ModelRouter({"execute": connection}, {"execute": provider}, strict_capabilities=strict)
    request = request_for(capability)
    if blocked:
        with pytest.raises(ModelProviderError) as error:
            router.select("execute", request, streaming=capability == "streaming")
        assert error.value.code == "model_capability_unavailable"
    else:
        actual, selection = router.select("execute", request, streaming=capability == "streaming")
        assert actual is provider
        assert selection["capability_status"] == ("unverified" if status == "unknown" else "satisfied")
    assert request.model_dump() == request_for(capability).model_dump()


def test_context_includes_tools_and_output_reservation(monkeypatch):
    monkeypatch.setattr(settings, "get_agent_settings", lambda: {})
    router = ModelRouter({"execute": {"context_limit": 100, "parameters": {"max_output_tokens": 50}}}, {"execute": object()})
    with pytest.raises(ModelProviderError) as error:
        router.select("execute", request_for("tools"))
    assert error.value.code == "model_context_limit"


def test_context_limit_requires_bounded_output_and_refuses_unknown_image_usage(monkeypatch):
    monkeypatch.setattr(settings, "get_agent_settings", lambda: {})
    router = ModelRouter({"execute": {"context_limit": 100_000}}, {"execute": object()})
    with pytest.raises(ModelProviderError, match="输出长度上限"):
        router.select("execute", request_for("streaming"))
    with pytest.raises(ModelProviderError, match="图片上下文用量"):
        router.select("execute", request_for("vision"))


def test_model_capability_error_in_classification_is_not_swallowed(catalog, monkeypatch):
    path, profiles = catalog
    update_model_profile(profiles["classify"]["profile_id"], {"context_limit": 1, "parameters": {"max_output_tokens": 1}}, path)
    save_routing_policy({"roles": policy_for(profiles)["roles"], "expected_version": 1}, path)
    calls = []
    class Provider:
        name = "openai"
        async def generate(self, request):
            calls.append(request)
            return ModelResponse(content="should not be called")
    monkeypatch.setattr(bootstrap, "build_model_provider", lambda **kwargs: Provider())
    with patch("app.agent.runtime.should_classify_kind", return_value=True):
        with pytest.raises(ModelProviderError) as failure:
            asyncio.run(bootstrap.get_agent_runtime().run("你好"))
    assert failure.value.code == "model_context_limit" and calls == []


def test_runtime_calls_three_roles_and_records_actual_stage(catalog, monkeypatch):
    path, profiles = catalog
    save_routing_policy({"roles": policy_for(profiles)["roles"], "expected_version": 1}, path)
    calls = []
    class RecordingProvider:
        name = "openai"
        def __init__(self, name):
            self.model = name
        async def generate(self, request):
            calls.append((self.model, current_model_call(), [tool.name for tool in request.tools]))
            return ModelResponse(content='{"kind":"conversation"}' if self.model == "classify" else '{"steps":[]}' if self.model == "plan" else "最终回答")
    monkeypatch.setattr(bootstrap, "build_model_provider", lambda **kwargs: RecordingProvider(kwargs["model"]))
    with patch("app.agent.runtime.should_classify_kind", return_value=True), patch("app.agent.runtime.refine_route_from_classifier", side_effect=lambda route, *args, **kwargs: route), patch("app.agent.runtime.route_task", return_value=TaskRoute("conversation", True, ())):
        runtime = bootstrap.get_agent_runtime()
        result = asyncio.run(runtime.run("你好", run_id="roles-run"))
    assert result.status == "done"
    assert [item[0] for item in calls] == ["classify", "plan", "execute"]
    assert [item[1]["stage"] for item in calls] == ["classify", "plan", "execute"]
    assert [item[1]["profile_id"] for item in calls] == [profiles[stage]["profile_id"] for stage in ("classify", "plan", "execute")]
    assert all(item[1]["run_id"] == "roles-run" for item in calls)
    assert calls[0][2] == [] and calls[1][2] == [] and calls[2][2] == ["ask_user"]
    selection = internal_model_selection(runtime.model_selection)
    save_routing_policy({"roles": {}, "expected_version": 2}, path)
    restored = bootstrap.get_agent_runtime(selection=selection)
    assert restored.model_selection["stage_selections"]["plan"]["profile_id"] == profiles["plan"]["profile_id"]
    assert bootstrap.get_agent_runtime().model_selection["model_name"] == "default"
    forged = deepcopy(selection)
    forged["stage_selections"]["plan"] = internal_model_selection(profiles["explicit"])
    with pytest.raises(ModelProviderError, match="阶段模型版本"):
        asyncio.run(restored.run("继续", model_selection=forged))

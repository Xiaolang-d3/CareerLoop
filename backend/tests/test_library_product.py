import asyncio

import pytest

from app.agent.bootstrap import _build_tool_registry
from app.agent.orchestration import ROUTE_LABELS, route_task
from app.agent.runtime import AgentRuntime
from app.agent.settings import DEFAULT_AGENT_SETTINGS, save_agent_settings
from app.config import get_settings
from app.db import init_db
from app.domain import AgentRunSnapshot, ModelResponse, ToolCall
from app.main import app
from app.models import ModelProviderRegistry
from app.profile.candidate_core import create_candidate_source, create_or_update_profile, review_fact
from app.profile.library import get_library, model_context
from app.profile.library_sources import create_text_source, update_source
from app.profile.service import parse_candidate_resume
from app.tools import ToolContext, ToolRegistry
from app.tools.library import GetLibraryContextTool, ProposeLibraryKnowledgeTool, SearchLibraryTool


@pytest.fixture
def library_db(tmp_path):
    path = tmp_path / "library.db"
    init_db(path)
    create_or_update_profile(name="读者", db_path=path)
    return path


def test_only_general_tools_and_routes_are_exposed():
    names = set(_build_tool_registry(get_settings()).names())
    assert names == {"ask_user", "get_library_context", "search_library", "propose_library_knowledge", "search_public_web"}
    assert set(ROUTE_LABELS) == {"conversation", "library_search", "library_update", "content_creation", "web_search"}
    paths = {route.path for route in app.routes}
    assert "/library" in paths
    assert not any(path.startswith(("/jobs", "/job-", "/quick-match", "/interview", "/resume-versions", "/career-profile", "/opportunit")) for path in paths)
    route = route_task("根据我的知识库写文章", names, profile_interview_active=True)
    assert route.kind == "content_creation"
    assert "get_library_context" in route.required_tools
    assert route_task("分析岗位匹配并准备面试", names).kind == "conversation"


def test_source_and_privacy_survive_library_read(library_db):
    content = "# 阅读笔记\n持续学习，需要每天记录一个问题。\n联系 reader@example.com"
    source = create_text_source(title="阅读笔记", content=content, db_path=library_db)
    before = get_library(library_db)
    assert before["sources"][0]["title"] == "阅读笔记"
    context = model_context(library_db)
    assert "reader@example.com" not in context["document"]
    assert "持续学习" in context["document"]
    update_source(source["id"], enabled=False, db_path=library_db)
    assert "持续学习" not in model_context(library_db)["document"]
    assert "strategies" not in before
    update_source(source["id"], enabled=True, db_path=library_db)
    result = asyncio.run(SearchLibraryTool(library_db).execute({"query": "持续学习"}, ToolContext(platform_name="manual")))
    assert result.ok and result.data["excerpts"]
    assert "reader@example.com" not in str(result.data)


def test_general_knowledge_stays_pending_until_review(library_db):
    result = asyncio.run(ProposeLibraryKnowledgeTool(library_db).execute(
        {"statements": ["每周整理一次读书笔记"]}, ToolContext(platform_name="manual")
    ))
    assert result.ok
    fact = result.data["proposals"][0]
    assert fact["status"] == "pending"
    assert not model_context(library_db)["confirmed_facts"]
    review_fact(fact["id"], status="confirmed", db_path=library_db)
    assert any(item["statement"] == "每周整理一次读书笔记" for item in model_context(library_db)["confirmed_facts"])


def test_document_parser_does_not_infer_career_fields():
    content = "阅读笔记：每天记录一个问题，每周整理一次笔记。联系 reader@example.com"
    parsed = parse_candidate_resume("notes.md", content.encode(), "fast")
    assert "reader@example.com" in parsed["text"]
    assert "reader@example.com" not in parsed["redacted_text"]
    assert parsed["suggested_skills"] == []
    assert not any(parsed["suggested_profile"].values())


def test_disabled_memory_is_not_read(library_db):
    create_candidate_source(source_type="resume", title="笔记", content="不会向模型公开的笔记内容", db_path=library_db)
    save_agent_settings({**DEFAULT_AGENT_SETTINGS, "profile_memory_enabled": False}, db_path=library_db)
    assert model_context(library_db)["disabled"]
    result = asyncio.run(SearchLibraryTool(library_db).execute({"query": "笔记"}, ToolContext(platform_name="manual")))
    assert result.data == {"excerpts": [], "facts": [], "disabled": True}


def test_library_api_round_trip_without_career_strategy(tmp_path, monkeypatch):
    from app import db as db_module
    from api_client import create_authenticated_client

    monkeypatch.setattr(db_module, "DB_PATH", tmp_path / "api.db")
    init_db()
    with create_authenticated_client(app) as client:
        response = client.put("/library", json={"name": "读者", "privacy_mode": "redacted"})
        assert response.status_code == 200
        text = "学习笔记：每天记录一个问题，每周回顾一次自己的阅读记录。"
        parsed = client.post("/library/document/parse", files={"file": ("notes.md", text.encode(), "text/markdown")})
        assert parsed.status_code == 200
        response = client.post("/library/sources", json={
            "source_type": "document", "title": "学习笔记", "content": parsed.json()["text"],
            "extract_knowledge": True,
        })
        assert response.status_code == 200
        assert response.json()["proposals"] == []
        bundle = client.get("/library").json()
        assert bundle["sources"][0]["title"] == "学习笔记"
        assert "active_strategy" not in bundle
        assert bundle["facts"] == []


class LibraryModel:
    name = "test-library"

    def __init__(self):
        self.calls = 0

    async def generate(self, request):
        self.calls += 1
        if self.calls == 1:
            return ModelResponse(content='{"goal":"总结资料","steps":[{"tool_name":"get_library_context","title":"读取资料"}]}')
        if self.calls == 2:
            return ModelResponse(tool_calls=[ToolCall(id="read-1", name="get_library_context", arguments={})])
        return ModelResponse(content="根据资料，可以每天记录一个问题。")


def test_creation_reads_library_and_does_not_resume_retired_checkpoint(library_db):
    models = ModelProviderRegistry()
    model = LibraryModel()
    models.register(model.name, model)
    tools = ToolRegistry()
    tools.register_handler(GetLibraryContextTool(library_db))
    runtime = AgentRuntime(models=models, tools=tools, model_provider=model.name, platform_name="manual", max_tool_rounds=5)
    snapshot = AgentRunSnapshot(
        resume_mode="checkpoint", route_kind="tailored_resume", needs_plan=True,
        allowed_tools=["generate_tailored_resume_content"],
    )
    result = asyncio.run(runtime.run("根据知识库总结资料", resume=snapshot))
    assert result.status == "done"
    assert result.plan.route == "content_creation"
    assert any(event.tool_name == "get_library_context" and event.status == "done" for event in result.events)
    assert not any(event.tool_name == "generate_tailored_resume_content" for event in result.events)

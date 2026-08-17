from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from app import db
from app.main import _active_chat_runs, app, cancel_current_agent_task
from app.workspace import ensure_workspace, use_workspace
from api_client import register_authenticated_client


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "careerloop.db")
    db.init_db()
    yield


def test_second_user_cannot_see_first_user_jobs() -> None:
    owner = register_authenticated_client(app, "owner@example.com")
    created = owner.post(
        "/jobs",
        json={
            "job_title": "私有岗位",
            "company_name": "仅自己可见",
            "description": "这是一段足够长的岗位描述，用来满足创建岗位的最小长度要求。",
        },
    )
    assert created.status_code == 200
    job_id = created.json()["id"]
    assert owner.get("/jobs").json()
    assert any(item["id"] == job_id for item in owner.get("/jobs").json())

    other = register_authenticated_client(app, "other@example.com")
    assert other.get("/jobs").json() == []
    assert other.get(f"/jobs/{job_id}").status_code == 404


def test_second_user_cannot_read_first_user_conversation() -> None:
    owner = register_authenticated_client(app, "owner@example.com")
    conversation = owner.post("/conversations", json={"title": "只给自己看的对话"}).json()
    other = register_authenticated_client(app, "other@example.com")
    assert other.patch(f"/conversations/{conversation['id']}", json={"title": "不应改到"}).status_code == 404
    assert all(item["title"] != "只给自己看的对话" for item in other.get("/conversations").json())


class ChatIsolationTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.original_db_path = db.DB_PATH
        db.DB_PATH = Path(self.temp_dir.name) / "careerloop.db"
        db.init_db()

    async def asyncTearDown(self) -> None:
        for task in list(_active_chat_runs.values()):
            task.cancel()
        await asyncio.gather(*_active_chat_runs.values(), return_exceptions=True)
        _active_chat_runs.clear()
        db.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    async def test_cancelling_one_user_chat_does_not_stop_another(self) -> None:
        owner = register_authenticated_client(app, "owner@example.com")
        other = register_authenticated_client(app, "other@example.com")
        owner_conversation = owner.post("/conversations", json={"title": "A"}).json()
        other_conversation = other.post("/conversations", json={"title": "B"}).json()
        owner_user = owner.get("/auth/me").json()["user"]["id"]
        other_user = other.get("/auth/me").json()["user"]["id"]

        async def wait_forever() -> None:
            await asyncio.Event().wait()

        owner_task = asyncio.create_task(wait_forever())
        other_task = asyncio.create_task(wait_forever())
        _active_chat_runs[(owner_user, owner_conversation["id"])] = owner_task
        _active_chat_runs[(other_user, other_conversation["id"])] = other_task

        with use_workspace(owner_user, ensure_workspace(owner_user)):
            result = await cancel_current_agent_task(owner_conversation["id"])
        await asyncio.gather(owner_task, return_exceptions=True)

        self.assertTrue(result["cancelled"])
        self.assertTrue(owner_task.cancelled())
        self.assertFalse(other_task.done())


def test_legacy_instance_data_is_adopted_by_the_first_user(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "careerloop.db")
    db.init_db()
    with db.connect(tmp_path / "careerloop.db") as conn:
        conn.execute("INSERT INTO jobs (job_title, company_name, description) VALUES (?, ?, ?)", (
            "旧岗位",
            "旧公司",
            "这是一段足够长的岗位描述，用来满足创建岗位的最小长度要求。",
        ))
    owner = register_authenticated_client(app, "legacy-owner@example.com")
    titles = [item["job_title"] for item in owner.get("/jobs").json()]
    assert "旧岗位" in titles
    other = register_authenticated_client(app, "newcomer@example.com")
    assert "旧岗位" not in [item["job_title"] for item in other.get("/jobs").json()]

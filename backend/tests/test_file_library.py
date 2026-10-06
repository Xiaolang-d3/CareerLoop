import asyncio

import pytest

from app.attachments.service import AttachmentStore, get_attachment
from app.db import DB_SCHEMA_VERSION, connect, init_db
from app.library.conversations import prepare_conversation
from app.library.organization import create_folder, organize_source
from app.library.service import get_library, model_context
from app.library.sources import create_text_source, get_source, get_source_file, import_file_source, update_source
from app.tools.base import ToolContext
from app.tools.library import SearchLibraryTool


@pytest.fixture
def library(tmp_path, monkeypatch):
    path = tmp_path / "files.db"
    init_db(path)
    store = AttachmentStore(local_root=tmp_path / "attachments")
    monkeypatch.setattr("app.attachments.service.get_attachment_store", lambda: store)
    return path


def test_organization_keeps_parser_metadata_and_trash_removes_context_and_index(library):
    source = import_file_source(filename="notes.txt", content_bytes="海王星资料 reader@example.com".encode(), db_path=library)
    folder = create_folder("阅读资料", library)
    updated = source["updated_at"]
    organize_source(source["id"], {"folder_id": folder["id"], "favorite": True, "opened": True}, library)
    current = get_source(source["id"], library)
    assert current["folder_id"] == folder["id"] and current["favorite"] and current["last_opened_at"]
    assert current["updated_at"] == updated
    assert current["metadata"]["parser"] == source["metadata"]["parser"]
    assert get_library(library)["folders"] == [folder]
    tool = SearchLibraryTool(library)
    search = lambda: asyncio.run(tool.execute({"query": "海王星"}, ToolContext(platform_name="test"))).data["excerpts"]
    assert search()
    organize_source(source["id"], {"trashed": True}, library)
    assert model_context(library)["document"] == "" and search() == []
    assert get_source_file(source["id"], library)[0].exists()
    organize_source(source["id"], {"trashed": False}, library)
    assert search() and "海王星" in model_context(library)["document"]
    organize_source(source["id"], {"folder_id": None}, library)
    assert get_source(source["id"], library)["folder_id"] is None
    assert get_source(source["id"], library)["favorite"]
    update_source(source["id"], enabled=False, db_path=library)
    organize_source(source["id"], {"trashed": True}, library)
    organize_source(source["id"], {"trashed": False}, library)
    assert not get_source(source["id"], library)["enabled"]
    assert not search()


def test_invalid_folder_does_not_change_source_and_duplicate_folder_is_rejected(library):
    source = create_text_source(title="笔记", content="资料", db_path=library)
    before = get_source(source["id"], library)
    with pytest.raises(ValueError, match="不存在"):
        organize_source(source["id"], {"folder_id": 999, "favorite": True}, library)
    assert get_source(source["id"], library) == before
    create_folder("Reading", library)
    with pytest.raises(ValueError, match="同名"):
        create_folder(" reading ", library)


def test_failed_extraction_retains_original_and_can_be_repaired(library, monkeypatch):
    monkeypatch.setattr("app.library.sources.parse_document_upload", lambda *args: (_ for _ in ()).throw(ValueError("cannot extract")))
    original = b"not-a-text-pdf"
    source = import_file_source(filename="scan.pdf", content_bytes=original, db_path=library)
    assert source["parse_status"] == "failed" and source["size_bytes"] == len(original)
    assert get_source_file(source["id"], library)[0].read_bytes() == original
    update_source(source["id"], title="扫描资料", db_path=library)
    assert model_context(library)["document"] == ""
    with pytest.raises(ValueError, match="补充"):
        prepare_conversation([source["id"]], library)
    update_source(source["id"], content="海王星修复文字", db_path=library)
    assert get_source(source["id"], library)["parse_status"] == "ready"
    assert get_source_file(source["id"], library)[0].read_bytes() == original


def test_selected_conversation_uses_privacy_snapshot_and_deduplicates(library):
    private = create_text_source(title="联系资料", content="读者 reader@example.com", db_path=library)
    original = create_text_source(title="公开资料", content="联系 other@example.com", privacy_mode="original", db_path=library)
    result = prepare_conversation([private["id"], original["id"], private["id"]], library)
    assert len(result["attachments"]) == 2
    snapshots = [get_attachment(item["id"], db_path=library) for item in result["attachments"]]
    assert "reader@example.com" not in snapshots[0]["parsed_text"]
    assert "other@example.com" in snapshots[1]["parsed_text"]
    assert all(item["parse_status"] == "parsed" for item in snapshots)
    assert all("object_key" not in item for item in result["attachments"])
    update_source(private["id"], content="后来校正", db_path=library)
    assert "后来校正" not in get_attachment(snapshots[0]["id"], db_path=library)["parsed_text"]
    with connect(library) as conn:
        assert conn.execute("SELECT COUNT(*) FROM chat_messages WHERE conversation_id = ?", (result["conversation"]["id"],)).fetchone()[0] == 0
    organize_source(original["id"], {"trashed": True}, library)
    with pytest.raises(ValueError, match="恢复"):
        prepare_conversation([original["id"]], library)


def test_conversation_failure_cleans_created_files_and_records(library, monkeypatch):
    from app.library import conversations
    sources = [create_text_source(title=str(i), content="资料内容", db_path=library) for i in range(2)]
    original = conversations.create_attachment
    count = 0
    def failing(*args, **kwargs):
        nonlocal count
        count += 1
        if count == 2:
            raise RuntimeError("storage unavailable")
        return original(*args, **kwargs)
    monkeypatch.setattr(conversations, "create_attachment", failing)
    with pytest.raises(RuntimeError, match="storage"):
        prepare_conversation([item["id"] for item in sources], library)
    with connect(library) as conn:
        assert conn.execute("SELECT COUNT(*) FROM attachments").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM conversations").fetchone()[0] == 1
    assert not [p for p in (library.parent / "attachments").rglob("*") if p.is_file()]


def test_v24_migration_preserves_sources_and_adds_folders(library):
    source = import_file_source(filename="old.txt", content_bytes="原资料内容".encode(), db_path=library)
    update_source(source["id"], enabled=False, db_path=library)
    before = get_source(source["id"], library)
    original = get_source_file(source["id"], library)[0].read_bytes()
    with connect(library) as conn:
        conn.execute("DELETE FROM schema_migrations WHERE version > 24")
        conn.execute("INSERT OR IGNORE INTO schema_migrations(version, name) VALUES (24, 'old')")
        conn.execute("DROP TABLE library_folders")
    init_db(library)
    init_db(library)
    assert get_source(source["id"], library) == before
    assert get_source_file(source["id"], library)[0].read_bytes() == original
    assert create_folder("新增目录", library)["id"] == 1
    with connect(library) as conn:
        assert conn.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == DB_SCHEMA_VERSION


def test_api_organization_body_search_and_chat_validation(tmp_path, monkeypatch):
    from app import db
    from app.main import app
    from api_client import create_authenticated_client
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "api.db")
    init_db()
    monkeypatch.setattr("app.attachments.service.get_attachment_store", lambda: AttachmentStore(local_root=tmp_path / "objects"))
    with create_authenticated_client(app) as client:
        saved = client.put("/library", json={"name": "", "privacy_mode": "redacted"})
        assert saved.status_code == 200 and saved.json()["profile"]["name"] == ""
        source = client.post("/library/sources", json={"title": "笔记", "content": "海王星资料"}).json()["source"]
        folder = client.post("/library/folders", json={"name": "阅读"}).json()
        response = client.patch(f"/library/sources/{source['id']}/organization", json={"folder_id": folder["id"], "favorite": True})
        assert response.status_code == 200 and response.json()["favorite"]
        assert client.get("/library/sources?q=海王星").json()[0]["id"] == source["id"]
        assert client.get("/library/sources?q=不存在").json() == []
        assert client.post("/library/conversations", json={"source_ids": []}).status_code == 422
        assert client.post("/library/conversations", json={"source_ids": [source["id"]]}).status_code == 200
        assert client.post("/library/folders", json={"name": "   "}).status_code == 422


def test_file_organization_is_account_local(tmp_path, monkeypatch):
    from app import db
    from app.main import app
    from api_client import register_authenticated_client
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "accounts.db")
    init_db()
    with register_authenticated_client(app, email="owner@example.test") as owner:
        source = owner.post("/library/sources", json={"title": "Owner", "content": "所有者文件"}).json()["source"]
        owner.post("/library/folders", json={"name": "私有目录"}).raise_for_status()
        with register_authenticated_client(app, email="other@example.test") as other:
            assert other.get("/library/folders").json() == []
            assert other.get("/library/sources").json() == []
            assert other.patch(f"/library/sources/{source['id']}/organization", json={"favorite": True}).status_code == 404
        assert not owner.get(f"/library/sources/{source['id']}").json()["favorite"]

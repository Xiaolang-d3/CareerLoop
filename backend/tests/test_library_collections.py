import pytest

from app.db import DB_SCHEMA_VERSION, connect, init_db
from app.library.collections import delete_collection, list_collections, save_collection, update_collection_sources
from app.library.organization import organize_source
from app.library.sources import create_text_source, delete_source, get_source, import_file_source, update_source


@pytest.fixture
def library(tmp_path):
    path = tmp_path / "topics.db"
    init_db(path)
    return path


def test_file_can_belong_to_multiple_collections_without_enabling_or_copying(library):
    file = create_text_source(title="项目复盘", content="项目证据", enabled=False, db_path=library)
    before = get_source(file["id"], library)
    first, second = [save_collection(name, library) for name in ("面试准备", "产品案例")]
    for collection in (first, second):
        update_collection_sources(collection["id"], [file["id"], file["id"]], db_path=library)
    assert [item["source_ids"] for item in list_collections(library)] == [[file["id"]], [file["id"]]]
    assert get_source(file["id"], library) == before
    with connect(library) as conn:
        assert conn.execute("SELECT COUNT(*) FROM library_sources").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM knowledge_chunks WHERE source_type = 'library_source'").fetchone()[0] == 0
    update_collection_sources(first["id"], [file["id"]], action="remove", db_path=library)
    assert list_collections(library)[0]["source_ids"] == []
    delete_collection(second["id"], library)
    assert get_source(file["id"], library) == before


def test_collection_membership_validation_is_atomic_and_names_are_normalized(library):
    source = create_text_source(title="笔记", content="有效正文", db_path=library)
    group = save_collection(" Reading  Notes ", library)
    assert group["name"] == "Reading Notes"
    with pytest.raises(ValueError, match="同名"):
        save_collection("reading notes", library)
    with pytest.raises(ValueError, match="不存在"):
        update_collection_sources(group["id"], [source["id"], 99999], db_path=library)
    assert list_collections(library)[0]["source_ids"] == []
    organize_source(source["id"], {"trashed": True}, library)
    with pytest.raises(ValueError, match="恢复"):
        update_collection_sources(group["id"], [source["id"]], db_path=library)
    assert list_collections(library)[0]["source_ids"] == []
    assert save_collection("新主题", library, collection_id=group["id"])["id"] == group["id"]


def test_create_collection_with_selected_files_is_atomic(library):
    source = create_text_source(title="存档", content="原文", enabled=False, db_path=library)
    with pytest.raises(ValueError, match="不存在"):
        save_collection("不能部分保存", library, source_ids=[source["id"], 999])
    assert list_collections(library) == []
    group = save_collection("本次选中文件", library, source_ids=[source["id"], source["id"]])
    assert list_collections(library)[0]["source_ids"] == [source["id"]]
    assert not get_source(source["id"], library)["enabled"]
    assert group["id"] == list_collections(library)[0]["id"]


def test_trash_restore_and_permanent_delete_keep_memberships_consistent(library):
    source = create_text_source(title="笔记", content="有效正文", db_path=library)
    group = save_collection("学习", library)
    update_collection_sources(group["id"], [source["id"]], db_path=library)
    organize_source(source["id"], {"trashed": True}, library)
    assert list_collections(library)[0]["file_count"] == 0
    assert list_collections(library)[0]["source_ids"] == [source["id"]]
    organize_source(source["id"], {"trashed": False}, library)
    assert list_collections(library)[0]["file_count"] == 1
    delete_source(source["id"], library)
    assert list_collections(library)[0]["source_ids"] == []


def test_v30_upgrade_preserves_existing_sources_and_indexes(library):
    sources = [create_text_source(title=str(i), content="原有资料", enabled=bool(i), db_path=library) for i in range(2)]
    before = [get_source(item["id"], library) for item in sources]
    with connect(library) as conn:
        indexes = [dict(row) for row in conn.execute("SELECT * FROM knowledge_chunks")]
        conn.execute("DROP TABLE library_collection_sources")
        conn.execute("DROP TABLE library_collections")
        conn.execute("DELETE FROM schema_migrations WHERE version > 30")
        conn.execute("INSERT OR IGNORE INTO schema_migrations(version, name) VALUES (30, 'unified_models_and_chat_assets')")
    init_db(library)
    init_db(library)
    assert [get_source(item["id"], library) for item in sources] == before
    assert list_collections(library) == []
    with connect(library) as conn:
        assert [dict(row) for row in conn.execute("SELECT * FROM knowledge_chunks")] == indexes
        assert conn.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == DB_SCHEMA_VERSION
    assert (library.parent / ".upgrade-backups" / f"before-schema-v{DB_SCHEMA_VERSION}" / library.name).is_file()


def test_archive_imports_are_readable_but_not_indexed_until_enabled(library):
    from app.library.service import model_context
    source = import_file_source(filename="notes.txt", content_bytes="仅存档资料".encode(), enabled=False, db_path=library)
    assert source["parse_status"] == "ready" and not source["enabled"]
    assert model_context(library)["document"] == ""
    update_source(source["id"], enabled=True, db_path=library)
    assert "仅存档资料" in model_context(library)["document"]


def test_collection_api_is_account_local_and_archive_contract_is_explicit(tmp_path, monkeypatch):
    from app import db
    from app.main import app
    from api_client import register_authenticated_client
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "accounts.db")
    init_db()
    with register_authenticated_client(app, email="topic-owner@example.test") as owner:
        source = owner.post("/library/sources", json={"title": "私有资料", "content": "私有正文", "enabled": False}).json()["source"]
        assert not source["enabled"]
        imported = owner.post("/library/sources/import", files={"files": ("notes.txt", "存档正文".encode(), "text/plain")}, data={"enabled": "false"}).json()["results"][0]
        assert imported["ok"] and not imported["source"]["enabled"]
        group = owner.post("/library/collections", json={"name": "私有主题"}).json()
        response = owner.patch(f"/library/collections/{group['id']}/sources", json={"source_ids": [source["id"]]})
        assert response.status_code == 200
        with register_authenticated_client(app, email="topic-other@example.test") as other:
            assert other.get("/library/collections").json() == []
            assert other.get("/library").json()["collections"] == []
            assert other.patch(f"/library/collections/{group['id']}", json={"name": "changed"}).status_code == 404
            assert other.delete(f"/library/collections/{group['id']}").status_code == 404
            assert other.patch(f"/library/collections/{group['id']}/sources", json={"source_ids": [source["id"]]}).status_code == 404
            local = other.post("/library/collections", json={"name": "自己的集合"}).json()
            assert other.patch(f"/library/collections/{local['id']}/sources", json={"source_ids": [source["id"]]}).status_code == 404
        assert owner.get("/library").json()["collections"][0]["source_ids"] == [source["id"]]
        assert owner.patch(f"/library/collections/{group['id']}", json={"name": "重命名"}).status_code == 200
        assert owner.delete(f"/library/collections/{group['id']}").status_code == 200
        assert owner.get(f"/library/sources/{source['id']}").status_code == 200

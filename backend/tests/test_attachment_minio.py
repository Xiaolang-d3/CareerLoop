from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from minio.error import S3Error

import app.attachments.service as service
from app.config import Settings
from app.db import init_db


@pytest.fixture
def remote_store(tmp_path, monkeypatch):
    store = service.AttachmentStore(local_root=tmp_path / "cache", storage="minio")
    store.settings = Settings(attachment_storage="minio")
    objects = {}
    client = Mock()
    client.responses = []
    client.bucket_exists.return_value = True

    def put(bucket, key, stream, length, **kwargs):
        objects[key] = stream.read()

    def get(bucket, key):
        if key not in objects:
            raise S3Error("NoSuchKey", "missing", key, "request", "host", None)
        response = Mock(read=Mock(return_value=objects[key]))
        client.responses.append(response)
        return response

    client.put_object.side_effect = put
    client.get_object.side_effect = get
    client.remove_object.side_effect = lambda bucket, key: objects.pop(key, None)
    monkeypatch.setattr(store, "_minio_client", lambda: client)
    return store, client, objects


def test_default_store_honors_minio_configuration(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "get_settings", lambda: SimpleNamespace(attachment_storage="minio"))
    monkeypatch.setattr(service, "attachments_dir", lambda: tmp_path / "user-attachments")
    assert service.get_attachment_store().storage == "minio"
    assert service.get_attachment_store().local_root == tmp_path / "user-attachments"
    assert service.AttachmentStore(local_root=tmp_path / "test").storage == "local"


def test_minio_attachment_preview_downloads_caches_and_deletes(tmp_path, remote_store):
    store, client, objects = remote_store
    db = tmp_path / "attachments.db"
    init_db(db)
    attachment = service.create_attachment(1, "document", "notes.txt", b"private notes", db_path=db, store=store)
    assert len(objects) == 1
    key = next(iter(objects))
    assert not (store.local_root / key).exists()

    path, filename, _ = service.get_attachment_file(attachment["id"], db_path=db, store=store)
    assert filename == "notes.txt" and path.read_bytes() == b"private notes"
    assert store.get(key) == b"private notes"
    assert client.get_object.call_count == 1
    client.responses[0].close.assert_called_once()
    client.responses[0].release_conn.assert_called_once()
    assert service.delete_attachment(attachment["id"], db_path=db, store=store)
    assert not path.exists() and not objects
    assert service.list_attachments(1, db_path=db) == []


def test_switch_to_minio_keeps_legacy_local_attachments_readable(tmp_path, remote_store):
    remote, client, objects = remote_store
    local = service.AttachmentStore(local_root=remote.local_root)
    db = tmp_path / "attachments.db"
    init_db(db)
    attachment = service.create_attachment(1, "document", "legacy.txt", b"legacy", db_path=db, store=local)
    path, _, _ = service.get_attachment_file(attachment["id"], db_path=db, store=remote)
    key = path.relative_to(remote.local_root).as_posix()
    assert remote.get(key) == b"legacy"
    client.get_object.assert_not_called()
    assert not objects
    assert service.delete_attachment(attachment["id"], db_path=db, store=remote)
    assert not path.exists()


def test_minio_images_can_be_previewed_and_sent_inline(tmp_path, remote_store, monkeypatch):
    from PIL import Image
    import base64

    store, client, _ = remote_store
    db = tmp_path / "attachments.db"
    init_db(db)
    buffer = BytesIO()
    Image.new("RGB", (2, 2), "blue").save(buffer, format="PNG")
    image = buffer.getvalue()
    attachment = service.create_attachment(1, "image", "image.png", image, db_path=db, store=store)
    monkeypatch.setattr(service, "get_settings", lambda: SimpleNamespace(attachment_vision_enabled=True))
    url = service.prepare_attachment_vision_url(attachment["id"], db_path=db, store=store)
    assert base64.b64decode(url.split(",", 1)[1]) == image
    service.get_attachment_file(attachment["id"], db_path=db, store=store)
    client.presigned_get_object.assert_not_called()


def test_missing_minio_object_is_reported_as_missing_file(tmp_path, remote_store):
    store, _, objects = remote_store
    db = tmp_path / "attachments.db"
    init_db(db)
    attachment = service.create_attachment(1, "document", "gone.txt", b"gone", db_path=db, store=store)
    objects.clear()
    with pytest.raises(ValueError, match="原文件不存在"):
        service.get_attachment_file(attachment["id"], db_path=db, store=store)


def test_object_store_keys_cannot_escape_local_cache(remote_store):
    store, client, _ = remote_store
    with pytest.raises(ValueError, match="路径无效"):
        store.get("../outside.txt")
    client.get_object.assert_not_called()

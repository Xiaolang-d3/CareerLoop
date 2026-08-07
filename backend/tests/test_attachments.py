from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
import tempfile
import unittest
from pathlib import Path

import app.attachments as attachments_module
from app.attachments import (
    AttachmentStore,
    create_attachment,
    delete_attachment,
    delete_conversation_attachments,
    list_attachments,
    parse_attachment,
    prepare_attachment_vision_url,
    validate_attachment,
)
from app.db import init_db

def png_1x1() -> bytes:
    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (1, 1), color="white").save(buffer, format="PNG")
    return buffer.getvalue()


class FakeVisionStore:
    def __init__(self) -> None:
        self.requested_keys: list[str] = []

    def presigned_get_url(self, object_key: str) -> str:
        self.requested_keys.append(object_key)
        return f"https://cdn.example.test/{object_key}?signature=test"


class AttachmentServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        root = Path(self._temp_dir.name)
        self.db_path = root / "test.db"
        self.store = AttachmentStore(local_root=root / "objects")
        init_db(self.db_path)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def test_resume_is_private_until_parsed_and_can_be_deleted(self) -> None:
        attachment = create_attachment(
            1,
            "resume",
            "candidate.txt",
            "张三\nPython 工程师\nFastAPI 与 Agent 开发经验".encode(),
            db_path=self.db_path,
            store=self.store,
        )
        self.assertEqual(attachment["parse_status"], "pending")
        self.assertNotIn("object_key", attachment)

        parsed = parse_attachment(attachment["id"], db_path=self.db_path, store=self.store)
        self.assertEqual(parsed["parse_status"], "parsed")
        self.assertIn("FastAPI", parsed["parsed_text"])
        self.assertTrue(parsed["redacted_text"])
        self.assertEqual(parsed["metadata"]["parser"], "lightweight")

        self.assertEqual(len(list_attachments(1, db_path=self.db_path)), 1)
        self.assertTrue(delete_attachment(attachment["id"], db_path=self.db_path, store=self.store))
        self.assertEqual(list_attachments(1, db_path=self.db_path), [])

    def test_rejects_invalid_attachment_before_storage(self) -> None:
        with self.assertRaises(ValueError):
            validate_attachment("job_screenshot", "resume.pdf", b"not an image")
        with self.assertRaises(ValueError):
            validate_attachment("resume", "resume.exe", b"invalid")

    def test_job_screenshot_skips_ocr_and_requires_vision(self) -> None:
        attachment = create_attachment(
            1,
            "job_screenshot",
            "job.png",
            png_1x1(),
            db_path=self.db_path,
            store=self.store,
        )

        parsed = parse_attachment(attachment["id"], db_path=self.db_path, store=self.store)

        self.assertEqual(parsed["parse_status"], "parsed")
        self.assertEqual(parsed["parsed_text"], "")
        self.assertEqual(parsed["redacted_text"], "")
        self.assertEqual(parsed["metadata"]["parser"], "image_only")
        self.assertTrue(parsed["metadata"]["vision_required"])

    def test_conversation_cleanup_deletes_database_rows_and_objects(self) -> None:
        first = create_attachment(
            1,
            "resume",
            "candidate.txt",
            "Python 工程师，具有 Agent 开发经验".encode(),
            db_path=self.db_path,
            store=self.store,
        )
        second = create_attachment(
            1,
            "job_screenshot",
            "job.png",
            png_1x1(),
            db_path=self.db_path,
            store=self.store,
        )
        object_paths = [
            self.store.local_root / f"{item['id'][:2]}/{item['id']}{'.txt' if item['kind'] == 'resume' else '.png'}"
            for item in (first, second)
        ]
        self.assertTrue(all(path.exists() for path in object_paths))

        self.assertEqual(
            delete_conversation_attachments(1, db_path=self.db_path, store=self.store),
            2,
        )
        self.assertEqual(list_attachments(1, db_path=self.db_path), [])
        self.assertTrue(all(not path.exists() for path in object_paths))

    def test_prepare_vision_url_requires_feature_flag(self) -> None:
        attachment = create_attachment(
            1,
            "job_screenshot",
            "job.png",
            png_1x1(),
            db_path=self.db_path,
            store=self.store,
        )
        original_get_settings = attachments_module.get_settings
        attachments_module.get_settings = lambda: SimpleNamespace(attachment_vision_enabled=False)
        try:
            with self.assertRaises(RuntimeError):
                prepare_attachment_vision_url(attachment["id"], db_path=self.db_path, store=FakeVisionStore())
        finally:
            attachments_module.get_settings = original_get_settings

    def test_prepare_vision_url_returns_signed_url_when_enabled(self) -> None:
        attachment = create_attachment(
            1,
            "job_screenshot",
            "job.png",
            png_1x1(),
            db_path=self.db_path,
            store=self.store,
        )
        fake_store = FakeVisionStore()
        original_get_settings = attachments_module.get_settings
        attachments_module.get_settings = lambda: SimpleNamespace(attachment_vision_enabled=True)
        try:
            signed_url = prepare_attachment_vision_url(attachment["id"], db_path=self.db_path, store=fake_store)
        finally:
            attachments_module.get_settings = original_get_settings

        self.assertTrue(signed_url.startswith("https://cdn.example.test/"))
        self.assertEqual(len(fake_store.requested_keys), 1)


if __name__ == "__main__":
    unittest.main()

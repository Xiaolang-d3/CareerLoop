from __future__ import annotations

import base64
from io import BytesIO
from types import SimpleNamespace
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import app.attachments.service as attachments_module
from app.attachments.service import (
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
            "document",
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
            validate_attachment("image", "resume.pdf", b"not an image")
        with self.assertRaises(ValueError):
            validate_attachment("document", "resume.exe", b"invalid")

    def test_job_screenshot_skips_ocr_and_requires_vision(self) -> None:
        attachment = create_attachment(
            1,
            "image",
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
            "document",
            "candidate.txt",
            "Python 工程师，具有 Agent 开发经验".encode(),
            db_path=self.db_path,
            store=self.store,
        )
        second = create_attachment(
            1,
            "image",
            "job.png",
            png_1x1(),
            db_path=self.db_path,
            store=self.store,
        )
        object_paths = [
            self.store.local_root / f"{item['id'][:2]}/{item['id']}{'.txt' if item['kind'] == 'document' else '.png'}"
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
            "image",
            "job.png",
            png_1x1(),
            db_path=self.db_path,
            store=self.store,
        )
        original_get_settings = attachments_module.get_settings
        attachments_module.get_settings = lambda: SimpleNamespace(attachment_vision_enabled=False)
        try:
            with self.assertRaises(RuntimeError):
                prepare_attachment_vision_url(attachment["id"], db_path=self.db_path, store=self.store)
        finally:
            attachments_module.get_settings = original_get_settings

    def test_prepare_vision_url_embeds_local_images_without_minio(self) -> None:
        from PIL import Image

        for suffix, image_format, content_type in [
            ("png", "PNG", "image/png"),
            ("jpg", "JPEG", "image/jpeg"),
            ("webp", "WEBP", "image/webp"),
        ]:
            with self.subTest(image_format=image_format):
                buffer = BytesIO()
                Image.new("RGB", (1, 1), color="white").save(buffer, format=image_format)
                content = buffer.getvalue()
                attachment = create_attachment(
                    1, "image", f"job.{suffix}", content,
                    db_path=self.db_path, store=self.store,
                )
                with patch.object(attachments_module, "get_settings", return_value=SimpleNamespace(attachment_vision_enabled=True)):
                    image_url = prepare_attachment_vision_url(attachment["id"], db_path=self.db_path, store=self.store)

                header, encoded = image_url.split(",", 1)
                self.assertEqual(header, f"data:{content_type};base64")
                self.assertEqual(base64.b64decode(encoded), content)
                saved = attachments_module.get_attachment(attachment["id"], db_path=self.db_path)
                self.assertEqual(saved["vision_status"], "consented")
                self.assertIsNotNone(saved["vision_consent_at"])

    def test_prepare_vision_reads_private_storage_without_a_public_url(self) -> None:
        content = png_1x1()
        attachment = create_attachment(
            1,
            "image",
            "job.png",
            content,
            db_path=self.db_path,
            store=self.store,
        )
        fake_store = Mock(spec=AttachmentStore)
        fake_store.get.return_value = content
        with patch.object(attachments_module, "get_settings", return_value=SimpleNamespace(attachment_vision_enabled=True)):
            image_url = prepare_attachment_vision_url(attachment["id"], db_path=self.db_path, store=fake_store)

        self.assertEqual(base64.b64decode(image_url.split(",", 1)[1]), content)
        fake_store.get.assert_called_once()
        fake_store.presigned_get_url.assert_not_called()


if __name__ == "__main__":
    unittest.main()

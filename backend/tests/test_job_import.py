from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from app.db import init_db
from app.job_import import ManualJobImport, import_manual_job


class ManualJobImportTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self._temp_dir.name) / "test.db"
        init_db(self.db_path)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def payload(self, **changes) -> ManualJobImport:
        data = {
            "consent": True,
            "input_method": "paste",
            "source_url": "https://www.zhipin.com/job_detail/abc123.html",
            "title": "AI Agent 工程师",
            "company": "示例科技",
            "location": "上海 浦东新区",
            "salary_text": "25-40K",
            "experience": "3-5年",
            "education": "本科",
            "description": "负责 Agent 平台开发",
        }
        data.update(changes)
        return ManualJobImport.model_validate(data)

    def test_user_confirmed_job_is_upserted(self) -> None:
        first = import_manual_job(self.payload(), self.db_path)
        second = import_manual_job(self.payload(description="负责本地 Agent 平台开发"), self.db_path)

        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(second["job"]["source"], "manual")
        self.assertEqual(second["job"]["city"], "上海")
        self.assertEqual(second["job"]["raw"]["imported_via"], "manual_paste")
        self.assertTrue(second["job"]["raw"]["user_confirmed"])

    def test_missing_link_gets_stable_manual_source(self) -> None:
        first = import_manual_job(self.payload(source_url=""), self.db_path)
        second = import_manual_job(self.payload(source_url=""), self.db_path)

        self.assertTrue(first["job"]["source_url"].startswith("manual://job/"))
        self.assertFalse(second["created"])

    def test_requires_explicit_confirmation(self) -> None:
        with self.assertRaises(ValidationError):
            self.payload(consent=False)

    def test_rejects_invalid_source_url(self) -> None:
        with self.assertRaises(ValidationError):
            self.payload(source_url="javascript:alert(1)")

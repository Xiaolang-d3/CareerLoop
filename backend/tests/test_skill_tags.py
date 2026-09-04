from __future__ import annotations

import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app import db as db_module
from app.db import init_db
from app.main import app
from app.models import ModelProviderError
from app.profile import skill_tags as skill_tags_module
from app.profile.skill_tags import resolve_home_skill_tags
from api_client import create_authenticated_client

STIFF_SKILLS = (
    "Python\nFastAPI\n"
    "熟练掌握 LangChain、RAG 检索增强、Prompt 工程、多模态 AI 开发\n"
    "具备 LLM 模型接入、微调优化、结构化输出约束能力。\n"
    "熟练使用 Python、FastAPI、Redis、Kafka、gRPC、WebSocket、Docker\n"
)


class FakeProvider:
    def __init__(self, content: str | Exception) -> None:
        self._content = content

    def __call__(self, **_kwargs):
        return self

    async def generate(self, _request):
        if isinstance(self._content, Exception):
            raise self._content
        return type("Response", (), {"content": self._content})()


class HomeSkillTagsTest(unittest.TestCase):
    def setUp(self) -> None:
        skill_tags_module._CACHE.clear()

    def test_without_model_returns_local_chips(self) -> None:
        with patch.object(skill_tags_module, "get_model_connection", return_value={
            "api_key": "", "model_name": "", "model_base_url": "",
        }):
            result = asyncio.run(resolve_home_skill_tags(STIFF_SKILLS))
        self.assertEqual(result["source"], "local")
        self.assertIn("LangChain", result["skills"])
        self.assertFalse(any("熟练掌握" in item for item in result["skills"]))

    def test_model_refine_keeps_grounded_tags_and_drops_inventions(self) -> None:
        provider = FakeProvider(json.dumps({
            "skills": ["Python", "LangChain", "Kubernetes", "熟练掌握 RAG"],
        }))
        with (
            patch.object(skill_tags_module, "get_model_connection", return_value={
                "api_key": "test", "model_name": "test", "model_base_url": "",
            }),
            patch.object(skill_tags_module, "build_model_provider", provider),
        ):
            result = asyncio.run(resolve_home_skill_tags(STIFF_SKILLS))

        self.assertEqual(result["source"], "model")
        self.assertIn("Python", result["skills"])
        self.assertIn("LangChain", result["skills"])
        self.assertNotIn("Kubernetes", result["skills"])
        self.assertFalse(any("熟练掌握" in item for item in result["skills"]))

    def test_model_error_falls_back_to_local(self) -> None:
        provider = FakeProvider(ModelProviderError("timeout", "模型超时"))
        with (
            patch.object(skill_tags_module, "get_model_connection", return_value={
                "api_key": "test", "model_name": "test", "model_base_url": "",
            }),
            patch.object(skill_tags_module, "build_model_provider", provider),
        ):
            result = asyncio.run(resolve_home_skill_tags(STIFF_SKILLS))

        self.assertEqual(result["source"], "local")
        self.assertIn("FastAPI", result["skills"])


class HomeSkillTagsApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.original_db_path = db_module.DB_PATH
        db_module.DB_PATH = Path(self.temp_dir.name) / "skill-tags.db"
        init_db()
        self.client = create_authenticated_client(app)
        skill_tags_module._CACHE.clear()

    def tearDown(self) -> None:
        self.client.close()
        db_module.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_endpoint_extracts_short_tags_from_saved_resume(self) -> None:
        created = self.client.put(
            "/career-profile",
            json={"name": "接口用户", "locale": "zh-CN", "privacy_mode": "redacted"},
        )
        self.assertEqual(created.status_code, 200)
        source = self.client.post(
            "/career-profile/sources",
            json={
                "source_type": "resume",
                "title": "cv.md",
                "content": STIFF_SKILLS,
                "privacy_mode": "redacted",
                "allow_model_original": False,
                "extract_knowledge": True,
            },
        )
        self.assertEqual(source.status_code, 200)
        with patch.object(skill_tags_module, "get_model_connection", return_value={
            "api_key": "", "model_name": "", "model_base_url": "",
        }):
            response = self.client.get("/career-profile/skill-tags")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["source"], "local")
        self.assertIn("Python", payload["skills"])
        self.assertIn("LangChain", payload["skills"])
        self.assertFalse(any("熟练掌握" in item for item in payload["skills"]))

    def test_endpoint_hides_rejected_skill_even_if_resume_mentions_it(self) -> None:
        self.client.put(
            "/career-profile",
            json={"name": "接口用户", "locale": "zh-CN", "privacy_mode": "redacted"},
        )
        proposed = self.client.post(
            "/career-profile/facts",
            json={"category": "skill", "statement": "Redis", "canonical_key": "skill:redis", "value": {"name": "Redis"}},
        )
        self.assertEqual(proposed.status_code, 200)
        rejected = self.client.post(
            f"/career-profile/facts/{proposed.json()['id']}/review",
            json={"action": "reject"},
        )
        self.assertEqual(rejected.status_code, 200)
        source = self.client.post(
            "/career-profile/sources",
            json={
                "source_type": "resume",
                "title": "cv.md",
                "content": STIFF_SKILLS,
                "privacy_mode": "redacted",
                "allow_model_original": False,
                "extract_knowledge": True,
            },
        )
        self.assertEqual(source.status_code, 200)
        with patch.object(skill_tags_module, "get_model_connection", return_value={
            "api_key": "", "model_name": "", "model_base_url": "",
        }):
            response = self.client.get("/career-profile/skill-tags")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Redis", response.json()["skills"])
        self.assertIn("Python", response.json()["skills"])

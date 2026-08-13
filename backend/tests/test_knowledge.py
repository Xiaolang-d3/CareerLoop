import tempfile
import unittest
from pathlib import Path

from app.profile.candidate_core import (
    PROFILE_ID,
    create_candidate_source,
    create_or_update_profile,
)
from app.db import init_db
from app.knowledge import delete_document, index_document, search_knowledge


class ResumeKnowledgeWiringTest(unittest.TestCase):
    """Guard the profile-save to evidence-search chain.

    The index write was once dropped from the profile save path, which left
    search_resume_evidence reading an always-empty table and reporting zero
    evidence as a success.
    """

    def test_saving_resume_makes_evidence_searchable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "profile.db"
            init_db(db_path)
            create_or_update_profile(name="测试候选人", db_path=db_path)

            create_candidate_source(
                source_type="resume",
                title="候选人简历",
                content="使用 Python 和 FastAPI 构建本地求职 Agent，负责检索与评估模块。",
                db_path=db_path,
            )

            results = search_knowledge("FastAPI 检索", ["resume"], 3, db_path)
            self.assertTrue(results, "保存简历后应能检索到简历证据")
            self.assertEqual(results[0]["source_type"], "resume")
            self.assertEqual(results[0]["source_id"], str(PROFILE_ID))
            self.assertIn("FastAPI", results[0]["content"])

    def test_indexed_resume_text_is_redacted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "profile.db"
            init_db(db_path)
            create_or_update_profile(name="测试候选人", db_path=db_path)

            create_candidate_source(
                source_type="resume",
                title="候选人简历",
                content="联系邮箱 secret.person@example.com，负责 FastAPI 服务开发。",
                db_path=db_path,
            )

            results = search_knowledge("FastAPI 服务", ["resume"], 3, db_path)
            self.assertTrue(results)
            indexed = " ".join(result["content"] for result in results)
            self.assertNotIn("secret.person@example.com", indexed)


class KnowledgeTest(unittest.TestCase):
    def test_local_vector_knowledge_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "knowledge.db"
            init_db(db_path)
            count = index_document(
                "resume", 1, "脱敏简历",
                "使用 Python 和 FastAPI 构建本地求职 Agent，并通过 Docker 部署。",
                db_path=db_path,
            )
            self.assertEqual(count, 1)

            results = search_knowledge("Python Agent", ["resume"], 3, db_path)
            self.assertTrue(results)
            self.assertEqual(results[0]["source_type"], "resume")
            self.assertIn("Python", results[0]["content"])

            self.assertEqual(delete_document("resume", 1, db_path), 1)
            self.assertEqual(search_knowledge("Python Agent", ["resume"], 3, db_path), [])

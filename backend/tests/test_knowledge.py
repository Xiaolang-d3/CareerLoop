import tempfile
import unittest
from pathlib import Path

from app.db import init_db
from app.knowledge import delete_document, index_document, search_knowledge


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

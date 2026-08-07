from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.db import connect, init_db
from app.tool_call_audit import record_tool_call_event


class ToolCallAuditTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self._temp_dir.name) / "test.db"
        init_db(self.db_path)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def test_record_tool_call_event_is_queryable_by_tool_call_id(self) -> None:
        record_tool_call_event(
            conversation_id=7,
            round_number=1,
            tool_call_id="call-abc",
            tool_name="analyze_resume_against_jd",
            status="done",
            latency_ms=150,
            db_path=self.db_path,
        )

        with connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM agent_tool_calls WHERE tool_call_id = ?",
                ("call-abc",),
            ).fetchone()

        self.assertIsNotNone(row)
        self.assertEqual(row["conversation_id"], 7)
        self.assertEqual(row["tool_name"], "analyze_resume_against_jd")
        self.assertEqual(row["status"], "done")
        self.assertEqual(row["latency_ms"], 150)
        self.assertEqual(row["error_code"], "")

    def test_record_tool_call_event_stores_error_code_on_failure(self) -> None:
        record_tool_call_event(
            conversation_id=None,
            round_number=2,
            tool_call_id="call-timeout",
            tool_name="search_public_web",
            status="failed",
            latency_ms=60000,
            error_code="tool_timeout",
            db_path=self.db_path,
        )

        with connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM agent_tool_calls WHERE tool_call_id = ?",
                ("call-timeout",),
            ).fetchone()

        self.assertEqual(row["conversation_id"], 0)
        self.assertEqual(row["error_code"], "tool_timeout")


if __name__ == "__main__":
    unittest.main()

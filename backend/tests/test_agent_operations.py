from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.agent.operations import get_agent_operations_snapshot
from app.db import connect, init_db


class AgentOperationsSnapshotTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "agent-operations.db"
        init_db(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_snapshot_aggregates_runs_and_deduplicates_tool_events(self) -> None:
        payload = {
            "agent": {
                "provider": "openai",
                "platform": "manual",
                "rounds": 2,
                "status": "done",
                "plan": {"route": "company_research", "goal": "核验公司"},
                "events": [
                    {"tool_call_id": "call-1", "tool_name": "research_company", "status": "running"},
                    {"tool_call_id": "call-1", "tool_name": "research_company", "status": "done"},
                    {"tool_call_id": "thinking", "tool_name": "agent_thinking", "status": "done"},
                ],
            }
        }
        with connect(self.db_path) as conn:
            conversation_id = conn.execute(
                "INSERT INTO conversations (title) VALUES ('公司研究')"
            ).lastrowid
            conn.execute(
                """INSERT INTO chat_messages
                   (conversation_id, role, content, payload_json)
                   VALUES (?, 'assistant', '完成', ?)""",
                (conversation_id, json.dumps(payload)),
            )
            conn.execute(
                """INSERT INTO model_service_events
                   (request_kind, status, latency_ms, total_tokens, model_name)
                   VALUES ('chat', 'success', 1200, 345, 'test-model')"""
            )

        snapshot = get_agent_operations_snapshot(db_path=self.db_path)

        self.assertEqual(snapshot["summary"]["total_runs"], 1)
        self.assertEqual(snapshot["summary"]["successful_runs"], 1)
        self.assertEqual(snapshot["summary"]["total_tool_calls"], 1)
        self.assertEqual(snapshot["summary"]["total_tokens"], 345)
        self.assertEqual(snapshot["tool_breakdown"][0]["count"], 1)
        self.assertEqual(snapshot["recent_runs"][0]["route"], "company_research")

    def test_snapshot_rejects_unsupported_window(self) -> None:
        with self.assertRaisesRegex(ValueError, "仅支持"):
            get_agent_operations_snapshot(days=14, db_path=self.db_path)


if __name__ == "__main__":
    unittest.main()

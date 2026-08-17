from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.agent.settings import get_agent_settings, save_agent_settings
from app.db import init_db
from app.observability.model_monitor import (
    get_model_monitor_snapshot,
    record_model_service_event,
)


class ModelMonitorTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self._temp_dir.name) / "test.db"
        init_db(self.db_path)
        settings = get_agent_settings(self.db_path)
        settings.update(
            {
                "model_name": "monitor-test-model",
                "model_base_url": "https://models.example.test",
            }
        )
        save_agent_settings(settings, self.db_path)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def record(
        self,
        status: str,
        *,
        error_code: str = "",
        latency_ms: int = 100,
        response_id: str = "",
        total_tokens: int = 0,
    ) -> None:
        record_model_service_event(
            request_kind="stream",
            status=status,
            error_code=error_code,
            error_message="safe operational detail",
            latency_ms=latency_ms,
            total_tokens=total_tokens,
            model_name="monitor-test-model",
            base_url="https://models.example.test/v1",
            response_id=response_id,
            db_path=self.db_path,
        )

    def test_empty_monitor_is_unknown(self) -> None:
        snapshot = get_model_monitor_snapshot(db_path=self.db_path)

        self.assertEqual(snapshot["status"], "unknown")
        self.assertEqual(snapshot["summary"]["total_requests"], 0)
        self.assertIsNone(snapshot["summary"]["success_rate"])
        self.assertEqual(snapshot["usage"]["total_tokens"], 0)
        self.assertIsNone(snapshot["usage"]["remaining_quota"])
        self.assertFalse(snapshot["usage"]["quota_available"])

    def test_snapshot_aggregates_latency_and_error_types(self) -> None:
        self.record("success", latency_ms=120, total_tokens=80)
        self.record("success", latency_ms=280, total_tokens=120)
        self.record("error", error_code="request_timeout", latency_ms=60000)

        snapshot = get_model_monitor_snapshot(db_path=self.db_path)

        self.assertEqual(snapshot["status"], "degraded")
        self.assertEqual(snapshot["summary"]["total_requests"], 3)
        self.assertEqual(snapshot["summary"]["successful_requests"], 2)
        self.assertEqual(snapshot["summary"]["success_rate"], 66.7)
        self.assertEqual(snapshot["summary"]["average_latency_ms"], 200)
        self.assertEqual(snapshot["summary"]["p95_latency_ms"], 280)
        self.assertEqual(snapshot["summary"]["timeout_count"], 1)
        self.assertEqual(snapshot["error_breakdown"][0]["label"], "响应超时")
        self.assertEqual(snapshot["usage"]["total_tokens"], 200)
        self.assertIsNone(snapshot["usage"]["remaining_quota"])

    def test_response_id_is_persisted_for_traceability(self) -> None:
        self.record("success", response_id="chatcmpl-abc123")

        from app.db import connect

        with connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT response_id FROM model_service_events ORDER BY id DESC LIMIT 1"
            ).fetchone()

        self.assertEqual(row["response_id"], "chatcmpl-abc123")

    def test_two_latest_failures_mark_service_unavailable(self) -> None:
        self.record("success")
        self.record("error", error_code="rate_limited")
        self.record("error", error_code="request_timeout")

        snapshot = get_model_monitor_snapshot(db_path=self.db_path)

        self.assertEqual(snapshot["status"], "unavailable")
        self.assertEqual(snapshot["summary"]["consecutive_failures"], 2)
        self.assertIn("连续 2 次", snapshot["status_message"])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from ..db import connect, row_to_dict
from ..domain import AgentRunResult, AgentRunSnapshot, ToolCall, ToolError, ToolResult
from ..tooling import ToolSpec


TERMINAL_RUN_STATUSES = frozenset({"completed", "failed", "cancelled"})
REPLAYABLE_RUN_STATUSES = TERMINAL_RUN_STATUSES | {"waiting_user"}
SAFE_RETRY_RISKS = frozenset({"read_only", "derived_analysis", "external_read"})


@dataclass(frozen=True)
class ToolExecutionDecision:
    action: Literal["execute", "replay", "block"]
    result: ToolResult | None = None


class AgentRunStore:
    """SQLite-backed run, checkpoint and tool-idempotency ledger."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    def start_run(
        self,
        run_id: str,
        *,
        conversation_id: int | None,
        task_id: int | None,
        user_content: str,
    ) -> dict:
        with connect(self._db_path) as conn:
            conn.execute(
                """
                INSERT INTO agent_execution_runs
                    (run_id, conversation_id, task_id, user_content, status)
                VALUES (?, ?, ?, ?, 'queued')
                ON CONFLICT(run_id) DO NOTHING
                """,
                (run_id, conversation_id, task_id, user_content),
            )
            row = conn.execute(
                "SELECT * FROM agent_execution_runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if row is None:
                raise RuntimeError("Agent run 创建失败")
            if (
                row["conversation_id"] is not None
                and conversation_id is not None
                and int(row["conversation_id"]) != conversation_id
            ):
                raise ValueError("run_id 已属于其他对话")
            if row["status"] in {"queued", "interrupted"}:
                conn.execute(
                    """
                    UPDATE agent_execution_runs
                    SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE run_id = ?
                    """,
                    (run_id,),
                )
                row = conn.execute(
                    "SELECT * FROM agent_execution_runs WHERE run_id = ?",
                    (run_id,),
                ).fetchone()
        return self._decode_run(row_to_dict(row))

    def get_run(self, run_id: str) -> dict | None:
        with connect(self._db_path) as conn:
            row = conn.execute(
                "SELECT * FROM agent_execution_runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
        return self._decode_run(row_to_dict(row)) if row is not None else None

    def latest_for_conversation(self, conversation_id: int) -> dict | None:
        with connect(self._db_path) as conn:
            row = conn.execute(
                """
                SELECT * FROM agent_execution_runs
                WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT 1
                """,
                (conversation_id,),
            ).fetchone()
        return self._decode_run(row_to_dict(row)) if row is not None else None

    def list_steps(self, run_id: str) -> list[dict]:
        with connect(self._db_path) as conn:
            rows = conn.execute(
                """
                SELECT * FROM agent_run_steps
                WHERE run_id = ? ORDER BY position, id
                """,
                (run_id,),
            ).fetchall()
        return [row_to_dict(row) for row in rows]

    def list_tool_executions(self, run_id: str) -> list[dict]:
        with connect(self._db_path) as conn:
            rows = conn.execute(
                """
                SELECT * FROM agent_tool_executions
                WHERE run_id = ? ORDER BY id
                """,
                (run_id,),
            ).fetchall()
        return [row_to_dict(row) for row in rows]

    def bind_messages(
        self,
        run_id: str,
        *,
        user_message_id: int | None = None,
        assistant_message_id: int | None = None,
    ) -> None:
        with connect(self._db_path) as conn:
            conn.execute(
                """
                UPDATE agent_execution_runs
                SET user_message_id = COALESCE(user_message_id, ?),
                    assistant_message_id = COALESCE(assistant_message_id, ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
                """,
                (user_message_id, assistant_message_id, run_id),
            )

    def checkpoint(
        self,
        run_id: str,
        snapshot: AgentRunSnapshot,
    ) -> None:
        with connect(self._db_path) as conn:
            conn.execute(
                """
                UPDATE agent_execution_runs
                SET status = 'running', route_kind = ?, round_number = ?,
                    checkpoint_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ? AND status IN ('queued', 'running', 'interrupted')
                """,
                (
                    snapshot.route_kind,
                    snapshot.rounds_used,
                    snapshot.model_dump_json(),
                    run_id,
                ),
            )
            if snapshot.plan is not None:
                for position, step in enumerate(snapshot.plan.steps):
                    conn.execute(
                        """
                        INSERT INTO agent_run_steps
                            (run_id, step_id, position, title, tool_name, risk, status,
                             started_at, completed_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?,
                                CASE WHEN ? != 'pending' THEN CURRENT_TIMESTAMP ELSE NULL END,
                                CASE WHEN ? IN ('done', 'failed', 'blocked')
                                     THEN CURRENT_TIMESTAMP ELSE NULL END)
                        ON CONFLICT(run_id, step_id) DO UPDATE SET
                            position = excluded.position,
                            title = excluded.title,
                            tool_name = excluded.tool_name,
                            risk = excluded.risk,
                            status = excluded.status,
                            started_at = COALESCE(agent_run_steps.started_at, excluded.started_at),
                            completed_at = excluded.completed_at,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        (
                            run_id,
                            step.id,
                            position,
                            step.title,
                            step.tool_name,
                            step.risk,
                            step.status,
                            step.status,
                            step.status,
                        ),
                    )

    def finish(self, run_id: str, result: AgentRunResult) -> None:
        status = {
            "done": "completed",
            "failed": "failed",
            "waiting_user": "waiting_user",
            "cancelled": "cancelled",
        }[result.status]
        checkpoint_json = (
            result.snapshot.model_dump_json() if result.snapshot is not None else None
        )
        with connect(self._db_path) as conn:
            conn.execute(
                """
                UPDATE agent_execution_runs
                SET status = ?, round_number = ?, result_json = ?, stop_reason = ?,
                    checkpoint_json = COALESCE(?, checkpoint_json),
                    completed_at = CASE
                        WHEN ? IN ('completed', 'failed', 'cancelled')
                        THEN CURRENT_TIMESTAMP ELSE NULL END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
                """,
                (
                    status,
                    result.rounds,
                    result.model_dump_json(),
                    result.stop_reason,
                    checkpoint_json,
                    status,
                    run_id,
                ),
            )

    def load_checkpoint(self, run_id: str) -> AgentRunSnapshot | None:
        run = self.get_run(run_id)
        return run.get("checkpoint") if run else None

    def load_result(self, run_id: str) -> AgentRunResult | None:
        run = self.get_run(run_id)
        return run.get("result") if run else None

    def request_cancel(self, run_id: str) -> bool:
        with connect(self._db_path) as conn:
            changed = conn.execute(
                """
                UPDATE agent_execution_runs
                SET cancel_requested = 1, updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
                  AND status IN ('queued', 'running', 'waiting_user', 'interrupted')
                """,
                (run_id,),
            ).rowcount
        return bool(changed)

    def request_cancel_for_conversation(self, conversation_id: int) -> bool:
        with connect(self._db_path) as conn:
            row = conn.execute(
                """
                SELECT run_id FROM agent_execution_runs
                WHERE conversation_id = ?
                  AND status IN ('queued', 'running', 'waiting_user', 'interrupted')
                ORDER BY updated_at DESC LIMIT 1
                """,
                (conversation_id,),
            ).fetchone()
        return self.request_cancel(str(row["run_id"])) if row is not None else False

    def link_waiting_resume(self, conversation_id: int, resumed_by_run_id: str) -> str | None:
        with connect(self._db_path) as conn:
            row = conn.execute(
                """
                SELECT run_id FROM agent_execution_runs
                WHERE conversation_id = ? AND status = 'waiting_user'
                  AND resumed_by_run_id IS NULL AND run_id != ?
                ORDER BY updated_at DESC LIMIT 1
                """,
                (conversation_id, resumed_by_run_id),
            ).fetchone()
            if row is None:
                return None
            parent_run_id = str(row["run_id"])
            conn.execute(
                """
                UPDATE agent_execution_runs
                SET resumed_by_run_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
                """,
                (resumed_by_run_id, parent_run_id),
            )
            conn.execute(
                """
                UPDATE agent_execution_runs
                SET parent_run_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
                """,
                (parent_run_id, resumed_by_run_id),
            )
        return parent_run_id

    def is_cancel_requested(self, run_id: str) -> bool:
        with connect(self._db_path) as conn:
            row = conn.execute(
                "SELECT cancel_requested FROM agent_execution_runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
        return bool(row and row["cancel_requested"])

    def interrupt_active_runs(self) -> int:
        with connect(self._db_path) as conn:
            changed = conn.execute(
                """
                UPDATE agent_execution_runs
                SET status = 'interrupted', stop_reason = 'process_interrupted',
                    updated_at = CURRENT_TIMESTAMP
                WHERE status IN ('queued', 'running')
                """
            ).rowcount
            conn.execute(
                """
                UPDATE agent_tool_executions
                SET status = 'interrupted', updated_at = CURRENT_TIMESTAMP
                WHERE status = 'running'
                  AND run_id IN (
                      SELECT run_id FROM agent_execution_runs WHERE status = 'interrupted'
                  )
                """
            )
        return int(changed)

    def prepare_tool_call(
        self,
        run_id: str,
        fingerprint: str,
        tool_call: ToolCall,
        spec: ToolSpec,
    ) -> ToolExecutionDecision:
        with connect(self._db_path) as conn:
            row = conn.execute(
                """
                SELECT * FROM agent_tool_executions
                WHERE run_id = ? AND fingerprint = ?
                """,
                (run_id, fingerprint),
            ).fetchone()
            if row is None:
                conn.execute(
                    """
                    INSERT INTO agent_tool_executions
                        (run_id, fingerprint, tool_call_id, tool_name, arguments_json, risk)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        fingerprint,
                        tool_call.id,
                        tool_call.name,
                        json.dumps(tool_call.arguments, ensure_ascii=False, sort_keys=True),
                        spec.risk,
                    ),
                )
                return ToolExecutionDecision("execute")

            status = str(row["status"])
            stored = self._decode_tool_result(str(row["result_json"] or ""))
            if status == "done" and stored is not None:
                return ToolExecutionDecision("replay", self._replayed_result(stored))
            if status in {"waiting_approval", "blocked"} and stored is not None:
                return ToolExecutionDecision("replay", stored)
            if status == "failed" and spec.risk not in SAFE_RETRY_RISKS:
                return ToolExecutionDecision("replay", stored or self._uncertain_write_result())
            if status in {"running", "interrupted"} and spec.risk not in SAFE_RETRY_RISKS:
                return ToolExecutionDecision("block", self._uncertain_write_result())

            conn.execute(
                """
                UPDATE agent_tool_executions
                SET status = 'running', tool_call_id = ?, attempt_count = attempt_count + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ? AND fingerprint = ?
                """,
                (tool_call.id, run_id, fingerprint),
            )
        return ToolExecutionDecision("execute")

    def record_tool_result(
        self,
        run_id: str,
        fingerprint: str,
        result: ToolResult,
    ) -> None:
        with connect(self._db_path) as conn:
            conn.execute(
                """
                UPDATE agent_tool_executions
                SET status = ?, result_json = ?,
                    completed_at = CASE WHEN ? != 'running' THEN CURRENT_TIMESTAMP ELSE NULL END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ? AND fingerprint = ?
                """,
                (
                    result.status,
                    result.model_dump_json(),
                    result.status,
                    run_id,
                    fingerprint,
                ),
            )

    @staticmethod
    def _decode_run(run: dict) -> dict:
        raw_checkpoint = run.get("checkpoint")
        raw_result = run.get("result")
        run["checkpoint"] = (
            AgentRunSnapshot.model_validate(raw_checkpoint)
            if isinstance(raw_checkpoint, dict) and raw_checkpoint
            else None
        )
        run["result"] = (
            AgentRunResult.model_validate(raw_result)
            if isinstance(raw_result, dict) and raw_result
            else None
        )
        run["cancel_requested"] = bool(run.get("cancel_requested"))
        return run

    @staticmethod
    def _decode_tool_result(raw: str) -> ToolResult | None:
        return ToolResult.model_validate_json(raw) if raw else None

    @staticmethod
    def _replayed_result(result: ToolResult) -> ToolResult:
        return result.model_copy(
            update={"data": {**result.data, "idempotent_replay": True}}
        )

    @staticmethod
    def _uncertain_write_result() -> ToolResult:
        message = "上次本地写工具执行被中断，结果状态不确定，系统不会自动重放"
        return ToolResult(
            ok=False,
            status="blocked",
            data={"status": "blocked", "uncertain_previous_execution": True},
            message=message,
            error=ToolError(
                code="tool_execution_uncertain",
                message=message,
                retryable=False,
            ),
        )

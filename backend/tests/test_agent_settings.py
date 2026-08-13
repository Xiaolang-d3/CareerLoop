from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.agent.settings import get_agent_settings, persona_prompt, save_agent_settings
from app.conversations import create_conversation, ensure_active_task, reset_conversation_context
from app.db import connect, init_db


class AgentSettingsTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self._temp_dir.name) / "test.db"
        init_db(self.db_path)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def test_persona_and_memory_settings_are_persisted(self) -> None:
        settings = get_agent_settings(self.db_path)
        settings.update({
            "display_name": "机会顾问",
            "persona_role": "坦诚、重视证据的求职顾问",
            "response_style": "detailed",
            "custom_instructions": "优先指出风险",
            "profile_memory_enabled": False,
            "context_message_limit": 20,
        })
        saved = save_agent_settings(settings, self.db_path)

        self.assertEqual(saved["display_name"], "机会顾问")
        self.assertFalse(saved["profile_memory_enabled"])
        self.assertEqual(saved["context_message_limit"], 20)
        prompt = persona_prompt(saved)
        self.assertIn("不得覆盖", prompt)
        self.assertIn("实际工具权限", prompt)
        self.assertIn("优先指出风险", prompt)

    def test_context_reset_preserves_messages_and_moves_cutoff(self) -> None:
        conversation = create_conversation("上下文测试", self.db_path)
        task_id = ensure_active_task(conversation["id"], self.db_path)
        with connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO chat_messages (conversation_id, task_id, role, content) VALUES (?, ?, 'user', '旧任务')",
                (conversation["id"], task_id),
            )
            message_id = conn.execute("SELECT MAX(id) AS id FROM chat_messages").fetchone()["id"]

        reset = reset_conversation_context(conversation["id"], self.db_path)
        with connect(self.db_path) as conn:
            count = conn.execute(
                "SELECT COUNT(*) AS count FROM chat_messages WHERE conversation_id = ?",
                (conversation["id"],),
            ).fetchone()["count"]

        self.assertEqual(reset["context_cutoff_message_id"], message_id)
        self.assertEqual(count, 1)

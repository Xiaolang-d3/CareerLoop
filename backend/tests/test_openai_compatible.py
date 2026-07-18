from __future__ import annotations

import unittest

from app.domain import AgentMessage
from app.models.openai_compatible import OpenAICompatibleProvider


class OpenAICompatibleProviderTest(unittest.TestCase):
    def test_user_message_with_image_urls_uses_multimodal_content_blocks(self) -> None:
        converted = OpenAICompatibleProvider._convert_message(
            AgentMessage(
                role="user",
                content="请读取这张岗位截图",
                payload={"image_urls": ["https://cdn.example.test/job.png?signature=test"]},
            )
        )

        self.assertEqual(converted["role"], "user")
        self.assertEqual(converted["content"][0], {"type": "text", "text": "请读取这张岗位截图"})
        self.assertEqual(
            converted["content"][1],
            {
                "type": "image_url",
                "image_url": {"url": "https://cdn.example.test/job.png?signature=test"},
            },
        )


if __name__ == "__main__":
    unittest.main()

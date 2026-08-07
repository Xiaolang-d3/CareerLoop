from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

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

    def test_list_models_returns_sorted_unique_model_ids(self) -> None:
        provider = OpenAICompatibleProvider(
            api_key="test-key",
            model="test-model",
            base_url="https://models.example.test",
        )
        response = SimpleNamespace(
            data=[
                SimpleNamespace(id="model-b"),
                SimpleNamespace(id="model-a"),
                SimpleNamespace(id="model-b"),
            ]
        )
        with patch.object(
            provider._client.models,
            "list",
            new=AsyncMock(return_value=response),
        ):
            models = asyncio.run(provider.list_models())

        self.assertEqual(models, ["model-a", "model-b"])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.jobs.page_ai import JobImportAgentModel, JobImportAIError


class FakeCompletions:
    def __init__(self, *, name: str, arguments: str) -> None:
        self.name = name
        self.arguments = arguments
        self.request = None

    def create(self, **kwargs):
        self.request = kwargs
        call = SimpleNamespace(
            id="call-1",
            function=SimpleNamespace(name=self.name, arguments=self.arguments),
        )
        message = SimpleNamespace(tool_calls=[call], content="")
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class JobImportAgentModelTest(unittest.TestCase):
    def _model(self, *, name: str, arguments: str):
        completions = FakeCompletions(name=name, arguments=arguments)
        model = JobImportAgentModel.__new__(JobImportAgentModel)
        model._model = "test-model"
        model._client = SimpleNamespace(
            chat=SimpleNamespace(completions=completions)
        )
        return model, completions

    def test_returns_one_structured_tool_action(self) -> None:
        model, completions = self._model(
            name="inspect_job_url",
            arguments="{}",
        )

        action = model.next_action(
            messages=[{"role": "user", "content": "开始"}],
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "inspect_job_url",
                        "description": "检查",
                        "parameters": {"type": "object", "properties": {}},
                    },
                }
            ],
        )

        self.assertEqual(action.tool_name, "inspect_job_url")
        self.assertEqual(action.arguments, {})
        self.assertEqual(completions.request["tool_choice"], "required")

    def test_rejects_invalid_tool_arguments(self) -> None:
        model, _ = self._model(
            name="stop_job_import",
            arguments="{not-json",
        )

        with self.assertRaisesRegex(JobImportAIError, "无效工具参数"):
            model.next_action(
                messages=[{"role": "user", "content": "开始"}],
                tools=[],
            )


if __name__ == "__main__":
    unittest.main()

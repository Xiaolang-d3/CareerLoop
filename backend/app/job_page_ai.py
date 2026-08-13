from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    OpenAI,
    RateLimitError,
)

from .agent.settings import get_model_connection
from .config import get_settings


class JobImportAIError(RuntimeError):
    pass


@dataclass(frozen=True)
class JobImportModelAction:
    tool_call_id: str
    tool_name: str
    arguments: dict[str, Any]
    assistant_message: dict[str, Any]


class JobImportAgentModel:
    """Focused model gateway for the bounded job-import agent loop."""

    def __init__(self) -> None:
        settings = get_settings()
        connection = get_model_connection()
        if not connection["api_key"]:
            raise JobImportAIError("岗位导入智能体未配置 API Key")
        self._model = connection["model_name"]
        self._client = OpenAI(
            api_key=connection["api_key"],
            base_url=_normalize_base_url(connection["model_base_url"]),
            timeout=min(settings.model_timeout_seconds, 20),
            max_retries=0,
        )

    def next_action(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> JobImportModelAction:
        try:
            response = self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                tools=tools,
                tool_choice="required",
            )
        except AuthenticationError as exc:
            raise JobImportAIError("岗位导入智能体认证失败") from exc
        except RateLimitError as exc:
            raise JobImportAIError("岗位导入智能体触发限流，请稍后重试") from exc
        except APITimeoutError as exc:
            raise JobImportAIError("岗位导入智能体响应超时，请稍后重试") from exc
        except APIConnectionError as exc:
            raise JobImportAIError("暂时无法连接岗位导入智能体") from exc
        except APIStatusError as exc:
            raise JobImportAIError(f"岗位导入智能体服务异常（HTTP {exc.status_code}）") from exc

        if not response.choices:
            raise JobImportAIError("岗位导入智能体没有返回决策")
        message = response.choices[0].message
        calls = list(message.tool_calls or [])
        if len(calls) != 1:
            raise JobImportAIError("岗位导入智能体必须且只能选择一个下一步工具")
        call = calls[0]
        try:
            arguments = json.loads(call.function.arguments or "{}")
        except json.JSONDecodeError as exc:
            raise JobImportAIError("岗位导入智能体返回了无效工具参数") from exc
        if not isinstance(arguments, dict):
            raise JobImportAIError("岗位导入智能体工具参数格式不正确")
        return JobImportModelAction(
            tool_call_id=call.id,
            tool_name=call.function.name,
            arguments=arguments,
            assistant_message={
                "role": "assistant",
                "content": message.content or None,
                "tool_calls": [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments or "{}",
                        },
                    }
                ],
            },
        )


def _normalize_base_url(base_url: str) -> str | None:
    if not base_url:
        return None
    normalized = base_url.rstrip("/")
    return normalized if normalized.endswith("/v1") else f"{normalized}/v1"

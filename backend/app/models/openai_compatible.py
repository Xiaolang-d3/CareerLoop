from __future__ import annotations

import json
from typing import Any

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    RateLimitError,
)

from ..domain import ModelRequest, ModelResponse, ModelUsage, ToolCall
from .base import ModelProviderError


SYSTEM_PROMPT = """你是 BossCopilot 的求职搜索 Agent，使用中文回答。
你的所有岗位信息必须来自工具，禁止编造岗位。
收到找工作请求时先调用 search_jobs；搜索成功且有岗位后，必须调用 rank_jobs 对原始岗位列表排序；最后基于排序结果给出简洁结论。
如果工具返回 blocked 或 failed，直接解释阻塞原因和用户下一步需要做什么，不要重复调用失败工具。
最终回答使用易读的纯文本，不使用 Markdown 标记。"""


class OpenAICompatibleProvider:
    name = "openai"

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str | None = None,
        timeout_seconds: float = 60,
    ) -> None:
        if not api_key:
            raise ValueError("启用 OpenAI Provider 时必须配置 OPENAI_API_KEY")
        self._model = model
        self._base_url = self._normalize_base_url(base_url)
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=self._base_url,
            timeout=timeout_seconds,
            max_retries=0,
        )

    @staticmethod
    def _normalize_base_url(base_url: str | None) -> str | None:
        if not base_url:
            return None
        normalized = base_url.rstrip("/")
        return normalized if normalized.endswith("/v1") else f"{normalized}/v1"

    async def generate(self, request: ModelRequest) -> ModelResponse:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(self._convert_message(message) for message in request.messages)
        tools = [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                },
            }
            for tool in request.tools
        ]
        arguments: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
        }
        if tools:
            arguments["tools"] = tools
            arguments["tool_choice"] = "auto"

        try:
            response = await self._client.chat.completions.create(**arguments)
        except AuthenticationError as exc:
            raise ModelProviderError(
                "authentication_failed",
                "模型服务认证失败，请检查 API Key 是否有效",
            ) from exc
        except RateLimitError as exc:
            raise ModelProviderError(
                "rate_limited",
                "模型服务触发限流，请稍后重试",
                retryable=True,
            ) from exc
        except APITimeoutError as exc:
            raise ModelProviderError(
                "request_timeout",
                "模型服务响应超时，请稍后重试",
                retryable=True,
            ) from exc
        except APIConnectionError as exc:
            raise ModelProviderError(
                "service_unavailable",
                "无法连接模型服务，请检查网关地址或网络状态",
                retryable=True,
            ) from exc
        except APIStatusError as exc:
            raise ModelProviderError(
                "provider_error",
                f"模型服务返回异常状态（{exc.status_code}）",
                retryable=exc.status_code >= 500,
            ) from exc

        choice = response.choices[0]
        message = choice.message
        tool_calls = []
        for call in message.tool_calls or []:
            try:
                parsed_arguments = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError as exc:
                raise ModelProviderError(
                    "invalid_tool_arguments",
                    f"模型返回的工具参数无法解析：{call.function.name}",
                ) from exc
            tool_calls.append(
                ToolCall(id=call.id, name=call.function.name, arguments=parsed_arguments)
            )

        usage = None
        if response.usage is not None:
            usage = ModelUsage(
                input_tokens=response.usage.prompt_tokens,
                output_tokens=response.usage.completion_tokens,
                total_tokens=response.usage.total_tokens,
            )
        return ModelResponse(
            content=message.content or "",
            tool_calls=tool_calls,
            usage=usage,
            provider_metadata={
                "model": response.model,
                "finish_reason": choice.finish_reason,
                "response_id": response.id,
                "base_url": self._base_url,
            },
        )

    @staticmethod
    def _convert_message(message) -> dict[str, Any]:
        if message.role == "assistant" and message.payload.get("tool_calls"):
            tool_calls = [
                {
                    "id": call["id"],
                    "type": "function",
                    "function": {
                        "name": call["name"],
                        "arguments": json.dumps(call.get("arguments", {}), ensure_ascii=False),
                    },
                }
                for call in message.payload["tool_calls"]
            ]
            return {"role": "assistant", "content": message.content or None, "tool_calls": tool_calls}
        if message.role == "tool":
            return {
                "role": "tool",
                "tool_call_id": message.tool_call_id,
                "content": json.dumps(message.payload, ensure_ascii=False),
            }
        return {"role": message.role, "content": message.content}

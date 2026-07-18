from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    RateLimitError,
)

from ..domain import ModelRequest, ModelResponse, ModelStreamEvent, ModelUsage, ToolCall
from ..agent_settings import get_agent_settings, persona_prompt
from .base import ModelProviderError


SYSTEM_PROMPT = """你是 BossCopilot 的本地求职 Agent，使用中文回答。
你的所有岗位事实必须来自工具，禁止编造岗位、公司、招聘者或执行结果。

按任务阶段选择工具，而不是机械执行固定链路：
1. 用户本人负责在招聘平台中登录、浏览、沟通和投递。你不得访问、读取、控制招聘网站，也不得尝试自动搜索、刷新、翻页、填写或提交。
2. 用户要求获取、导入或分析尚未进入本地系统的岗位时，调用 request_manual_job_import，请用户主动粘贴岗位文字或上传自己保存的截图。不要要求或声称可以通过浏览器、插件或扩展读取页面。
3. 个性化匹配或沟通准备：先调用 get_candidate_context，不得要求用户重复输入已经保存在画像中的目标岗位、城市或薪资。
4. 深入推荐：先用 get_job_detail 从本地岗位库确认岗位和本地 ID，再调用 analyze_job 保存个性化分析；这两个工具都只读取或修改本地数据，不访问招聘网站。
4a. 用户询问简历与岗位的技能差距、缺口或改进方向时，调用 analyze_resume_gap；需要从本地简历、岗位或笔记查找证据时调用 search_local_knowledge。引用证据时说明来源和分析局限。
5. 只有用户明确要求收藏或跳过时，才能调用 update_job_status。
6. 只有用户明确要求生成并保存话术时，才能调用 save_greeting_draft。话术必须基于候选人真实经历，不得夸大。
7. 只有用户明确要求加入待投递队列时，才能调用 queue_application。
8. 只有用户明确陈述真实进展时，才能调用 update_application_status。

save_greeting_draft、queue_application 和 update_application_status 只修改本地记录，绝不代表已在 BOSS 发送消息、简历或完成投递。当前没有任何外部发送工具，不得声称已执行外部操作。
如果工具返回 waiting_approval、blocked 或 failed，解释阻塞原因和下一步，不要重复调用同一失败工具。
执行过程、工具选择和“我先读取/我将检查”等过程叙述会由界面单独展示。最终回答只输出对用户有用的结论、问题或下一步，禁止在最终回答中重复执行过程。
最终回答使用清晰、克制的 Markdown；可以使用短标题、列表、表格、引用和代码块，但不得输出 HTML。"""


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
        arguments = self._request_arguments(request)

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

        return self._response_from_completion(response)

    async def stream(self, request: ModelRequest) -> AsyncIterator[ModelStreamEvent]:
        arguments = self._request_arguments(request)
        arguments["stream"] = True
        content_parts: list[str] = []
        tool_parts: dict[int, dict[str, str]] = {}
        usage = None
        response_id = ""
        response_model = self._model
        finish_reason = None
        stream = None

        try:
            stream = await self._client.chat.completions.create(**arguments)
            async for chunk in stream:
                response_id = chunk.id or response_id
                response_model = chunk.model or response_model
                if chunk.usage is not None:
                    usage = ModelUsage(
                        input_tokens=chunk.usage.prompt_tokens,
                        output_tokens=chunk.usage.completion_tokens,
                        total_tokens=chunk.usage.total_tokens,
                    )
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                finish_reason = choice.finish_reason or finish_reason
                delta = choice.delta
                if delta.content:
                    content_parts.append(delta.content)
                    yield ModelStreamEvent(type="text_delta", delta=delta.content)
                for call in delta.tool_calls or []:
                    part = tool_parts.setdefault(
                        call.index,
                        {"id": "", "name": "", "arguments": ""},
                    )
                    if call.id:
                        part["id"] = call.id
                    if call.function is not None:
                        if call.function.name:
                            part["name"] += call.function.name
                        if call.function.arguments:
                            part["arguments"] += call.function.arguments
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
        finally:
            if stream is not None:
                close = getattr(stream, "close", None)
                if callable(close):
                    await close()

        tool_calls: list[ToolCall] = []
        for index in sorted(tool_parts):
            part = tool_parts[index]
            try:
                parsed_arguments = json.loads(part["arguments"] or "{}")
            except json.JSONDecodeError as exc:
                raise ModelProviderError(
                    "invalid_tool_arguments",
                    f"模型返回的工具参数无法解析：{part['name']}",
                ) from exc
            tool_calls.append(
                ToolCall(
                    id=part["id"] or f"stream-call-{index}",
                    name=part["name"],
                    arguments=parsed_arguments,
                )
            )
        yield ModelStreamEvent(
            type="completed",
            response=ModelResponse(
                content="".join(content_parts),
                tool_calls=tool_calls,
                usage=usage,
                provider_metadata={
                    "model": response_model,
                    "finish_reason": finish_reason,
                    "response_id": response_id,
                    "base_url": self._base_url,
                },
            ),
        )

    def _request_arguments(self, request: ModelRequest) -> dict[str, Any]:
        settings = get_agent_settings()
        messages = [{"role": "system", "content": SYSTEM_PROMPT + persona_prompt(settings)}]
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
        return arguments

    def _response_from_completion(self, response: Any) -> ModelResponse:
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
        image_urls = message.payload.get("image_urls") if isinstance(message.payload, dict) else None
        if message.role == "user" and image_urls:
            content: list[dict[str, Any]] = []
            if message.content:
                content.append({"type": "text", "text": message.content})
            for image_url in image_urls:
                if isinstance(image_url, str) and image_url:
                    content.append({"type": "image_url", "image_url": {"url": image_url}})
            return {"role": message.role, "content": content}
        return {"role": message.role, "content": message.content}

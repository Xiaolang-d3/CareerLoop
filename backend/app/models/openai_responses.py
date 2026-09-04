from __future__ import annotations

import json
from collections.abc import AsyncIterator
from time import perf_counter
from typing import Any

from openai import APIConnectionError, APIStatusError, APITimeoutError, AuthenticationError, RateLimitError

from ..agent.settings import get_agent_settings, persona_prompt
from ..domain import ModelRequest, ModelResponse, ModelStreamEvent, ModelUsage, ToolCall
from .base import ModelProviderError
from .openai_compatible import OpenAICompatibleProvider, SYSTEM_PROMPT, _TINY_PNG_DATA_URL, _looks_like_vision_rejection


_OPENAI_ERRORS = (
    AuthenticationError,
    RateLimitError,
    APITimeoutError,
    APIConnectionError,
    APIStatusError,
)


class OpenAIResponsesProvider(OpenAICompatibleProvider):
    """OpenAI Responses API provider sharing the configured API root and key."""

    name = "responses"

    async def generate(self, request: ModelRequest) -> ModelResponse:
        started_at = perf_counter()
        try:
            response = await self._client.responses.create(**self._request_arguments(request))
            result = self._response_from_response(response)
        except _OPENAI_ERRORS as exc:
            error = self._provider_error(exc)
            self._record_event("generate", started_at, error=error)
            raise error from exc
        except (ValueError, TypeError, AttributeError, json.JSONDecodeError) as exc:
            error = ModelProviderError("provider_error", "模型服务返回了无法解析的 Responses API 响应")
            self._record_event("generate", started_at, error=error)
            raise error from exc
        self._record_event(
            "generate",
            started_at,
            total_tokens=result.usage.total_tokens if result.usage else 0,
            response_id=result.provider_metadata.get("response_id", ""),
        )
        return result

    async def stream(self, request: ModelRequest) -> AsyncIterator[ModelStreamEvent]:
        started_at = perf_counter()
        arguments = self._request_arguments(request)
        arguments["stream"] = True
        stream = None
        completed_response = None
        try:
            stream = await self._client.responses.create(**arguments)
            async for event in stream:
                event_type = getattr(event, "type", "")
                if event_type == "response.output_text.delta":
                    delta = str(getattr(event, "delta", "") or "")
                    if delta:
                        yield ModelStreamEvent(type="text_delta", delta=delta)
                elif event_type == "response.completed":
                    completed_response = getattr(event, "response", None)
        except _OPENAI_ERRORS as exc:
            error = self._provider_error(exc)
            self._record_event("stream", started_at, error=error)
            raise error from exc
        finally:
            if stream is not None:
                close = getattr(stream, "close", None)
                if callable(close):
                    await close()
        if completed_response is None:
            error = ModelProviderError("provider_error", "Responses API 流式调用未返回完成事件")
            self._record_event("stream", started_at, error=error)
            raise error
        result = self._response_from_response(completed_response)
        self._record_event(
            "stream",
            started_at,
            total_tokens=result.usage.total_tokens if result.usage else 0,
            response_id=result.provider_metadata.get("response_id", ""),
        )
        yield ModelStreamEvent(type="completed", response=result)

    async def check_connection(self) -> None:
        started_at = perf_counter()
        try:
            response = await self._client.responses.create(
                model=self._model,
                input="仅回复 OK",
                max_output_tokens=16,
                store=False,
            )
        except _OPENAI_ERRORS as exc:
            error = self._provider_error(exc)
            self._record_event("health_check", started_at, error=error)
            raise error from exc
        usage = getattr(response, "usage", None)
        self._record_event(
            "health_check",
            started_at,
            total_tokens=int(getattr(usage, "total_tokens", 0) or 0),
            response_id=str(getattr(response, "id", "") or ""),
        )

    async def probe_vision(self) -> dict[str, str]:
        started_at = perf_counter()
        try:
            await self._client.responses.create(
                model=self._model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": "只回复 OK"},
                            {"type": "input_image", "image_url": _TINY_PNG_DATA_URL},
                        ],
                    }
                ],
                max_output_tokens=16,
                store=False,
            )
        except _OPENAI_ERRORS as exc:
            error = self._provider_error(exc)
            self._record_event("health_check", started_at, error=error)
            if _looks_like_vision_rejection(str(exc).lower(), getattr(exc, "status_code", None)):
                return {"status": "unsupported", "source": "probe", "detail": "服务拒绝了图片输入，当前模型不支持多模态"}
            raise error from exc
        self._record_event("health_check", started_at)
        return {"status": "supported", "source": "probe", "detail": "服务接受了图片输入，当前模型支持多模态"}

    def _request_arguments(self, request: ModelRequest) -> dict[str, Any]:
        settings = get_agent_settings()
        extra_instructions = "\n".join(
            message.content for message in request.messages if message.role == "system" and message.content
        )
        instructions = SYSTEM_PROMPT + persona_prompt(settings)
        if extra_instructions:
            instructions = f"{instructions}\n{extra_instructions}"
        input_items: list[dict[str, Any]] = []
        for message in request.messages:
            if message.role == "system":
                continue
            input_items.extend(self._convert_input_message(message))
        arguments: dict[str, Any] = {
            "model": self._model,
            "instructions": instructions,
            "input": input_items,
            "store": False,
        }
        if request.tools:
            arguments["tools"] = [
                {
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                    "strict": False,
                }
                for tool in request.tools
            ]
            arguments["tool_choice"] = request.tool_choice
        return arguments

    @staticmethod
    def _convert_input_message(message: Any) -> list[dict[str, Any]]:
        if message.role == "assistant" and message.payload.get("tool_calls"):
            items: list[dict[str, Any]] = []
            if message.content:
                items.append({"role": "assistant", "content": message.content})
            items.extend(
                {
                    "type": "function_call",
                    "call_id": call["id"],
                    "name": call["name"],
                    "arguments": json.dumps(call.get("arguments", {}), ensure_ascii=False),
                }
                for call in message.payload["tool_calls"]
            )
            return items
        if message.role == "tool":
            return [
                {
                    "type": "function_call_output",
                    "call_id": message.tool_call_id,
                    "output": json.dumps(message.payload, ensure_ascii=False),
                }
            ]
        image_urls = message.payload.get("image_urls") if isinstance(message.payload, dict) else None
        if message.role == "user" and image_urls:
            content: list[dict[str, Any]] = []
            if message.content:
                content.append({"type": "input_text", "text": message.content})
            content.extend(
                {"type": "input_image", "image_url": url}
                for url in image_urls
                if isinstance(url, str) and url
            )
            return [{"role": "user", "content": content}]
        return [{"role": "assistant" if message.role == "assistant" else "user", "content": message.content}]

    def _response_from_response(self, response: Any) -> ModelResponse:
        tool_calls: list[ToolCall] = []
        for item in getattr(response, "output", None) or []:
            if getattr(item, "type", "") != "function_call":
                continue
            try:
                arguments = json.loads(getattr(item, "arguments", "") or "{}")
            except json.JSONDecodeError as exc:
                raise ModelProviderError(
                    "invalid_tool_arguments",
                    f"模型返回的工具参数无法解析：{getattr(item, 'name', '')}",
                ) from exc
            tool_calls.append(
                ToolCall(
                    id=str(getattr(item, "call_id", "") or getattr(item, "id", "") or f"call-{len(tool_calls)}"),
                    name=str(getattr(item, "name", "") or ""),
                    arguments=arguments,
                )
            )
        raw_usage = getattr(response, "usage", None)
        usage = None
        if raw_usage is not None:
            usage = ModelUsage(
                input_tokens=int(getattr(raw_usage, "input_tokens", 0) or 0),
                output_tokens=int(getattr(raw_usage, "output_tokens", 0) or 0),
                total_tokens=int(getattr(raw_usage, "total_tokens", 0) or 0),
            )
        return ModelResponse(
            content=str(getattr(response, "output_text", "") or ""),
            tool_calls=tool_calls,
            usage=usage,
            provider_metadata={
                "model": getattr(response, "model", self._model),
                "finish_reason": getattr(response, "status", None),
                "response_id": getattr(response, "id", "") or "",
                "base_url": self._base_url,
                "protocol": self.name,
            },
        )

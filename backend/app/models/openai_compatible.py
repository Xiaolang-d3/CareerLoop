from __future__ import annotations

import json
from collections.abc import AsyncIterator
from time import perf_counter
from typing import Any

from openai import (
    APIConnectionError,
    APIError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    RateLimitError,
)

from ..domain import ModelRequest, ModelResponse, ModelStreamEvent, ModelUsage, ToolCall
from ..agent.settings import get_agent_settings, persona_prompt
from ..observability.model_monitor import record_model_service_event
from .base import ModelProviderError


_TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_VISION_REJECTION_MARKERS = (
    "image",
    "vision",
    "multimodal",
    "does not support",
    "not support",
    "unsupported",
    "invalid content",
)
_ACCOUNT_POOL_MARKERS = (
    "all available accounts exhausted",
    "no available accounts",
)
_MODEL_UNAVAILABLE_MARKERS = (
    "model not found",
    "model is not supported",
    "not supported by any configured account",
    "does not exist",
    "unknown model",
)


def _looks_like_vision_rejection(message: str, status_code: int | None) -> bool:
    del status_code
    return any(marker in message for marker in _VISION_REJECTION_MARKERS)


def _status_error_detail(exc: APIStatusError) -> str:
    """Pull a short upstream reason out of an OpenAI-compatible error body."""
    body = getattr(exc, "body", None)
    message = ""
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            message = str(error.get("message") or error.get("code") or "").strip()
        elif isinstance(error, str):
            message = error.strip()
        if not message:
            message = str(body.get("message") or "").strip()
    elif isinstance(body, str):
        message = body.strip()
    if not message:
        return ""
    if message.lstrip().startswith("<") or "<html" in message[:80].lower():
        return ""
    return message[:200]


SYSTEM_PROMPT = """你是 CareerLoop 的本地求职 Agent，使用中文回答。
不要编造岗位、公司、招聘者、候选人经历、来源或执行结果；清楚区分用户提供的信息、工具返回的信息和一般性建议。

能力与执行原则：
1. 对话覆盖完整求职流程，不把招聘网站访问、岗位搜索、沟通、投递或文件生成视为预先禁止的产品范围。需要执行动作时，只能使用本轮实际提供并允许的工具；缺少对应工具时，直接说明当前连接或能力缺失，并给出可行的接入或手动方案。不要点名或调用未提供的工具。
2. 对话不要求用户预先提供 JD。只有当用户明确要求岗位匹配、定制简历、面试准备等依赖具体岗位的结果，且当前上下文和工具结果都缺少岗位信息时，才自然询问用户补充 JD、截图、链接或其他可用来源。岗位要求必须忠实使用当前上下文或可信工具提供的内容，不得补写或猜测。
3. 没有检索到证据时必须明确说证据不足，不得夸大经历。不要重复要求用户粘贴系统中已经保存的简历。
4. 只有实际文件工具成功返回文件时，才能声称生成了 DOCX、PDF 或下载文件。没有公司公开资料或公司研究工具结果时，不得把模型记忆描述成实时公司研究。
5. 只有工具成功执行后，才能声称完成收藏、排序、保存、状态更新、外部发送、沟通或投递。涉及账号、对外发送和提交的工具应遵循其确认要求；不得规避验证码、安全验证或平台风控。

缺少继续执行所需的关键信息，或同一指代有多种合理解读时，调用 ask_user 列出选项并等待用户选择；不要猜测后继续，也不要只在正文里提问。
执行过程、工具选择和“我先读取/我将检查”等过程叙述会由界面单独展示。最终回答只输出对用户有用的结论、问题或下一步，禁止在最终回答中重复执行过程。
最终回答使用清晰、克制的 Markdown；可以使用短标题、列表、表格、引用和代码块，但不得输出 HTML。只有用户明确要求思维导图时，才可输出带 mermaid 语言标记的 Mermaid mindmap 代码块，界面会渲染成可展开、缩放的交互导图；普通回答不要默认生成图。"""


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
        # Base URL is the provider's complete API root.  Do not infer an API
        # version from the model name or silently append /v1: compatible
        # gateways may expose /chat/completions at the root or under a custom
        # prefix.  Callers that require /v1 must include it explicitly.
        return base_url.rstrip("/")

    async def generate(self, request: ModelRequest) -> ModelResponse:
        arguments = self._request_arguments(request)
        started_at = perf_counter()

        try:
            response = await self._client.chat.completions.create(**arguments)
        except (
            AuthenticationError,
            RateLimitError,
            APITimeoutError,
            APIConnectionError,
            APIStatusError,
        ) as exc:
            error = self._provider_error(exc)
            self._record_event("generate", started_at, error=error)
            raise error from exc

        try:
            result = self._response_from_completion(response)
        except ModelProviderError as error:
            self._record_event("generate", started_at, error=error)
            raise
        self._record_event(
            "generate",
            started_at,
            total_tokens=result.usage.total_tokens if result.usage else 0,
            response_id=result.provider_metadata.get("response_id", ""),
        )
        return result

    async def stream(self, request: ModelRequest) -> AsyncIterator[ModelStreamEvent]:
        arguments = self._request_arguments(request)
        arguments["stream"] = True
        started_at = perf_counter()
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
        except (
            AuthenticationError,
            RateLimitError,
            APITimeoutError,
            APIConnectionError,
            APIStatusError,
        ) as exc:
            error = self._provider_error(exc)
            self._record_event("stream", started_at, error=error)
            raise error from exc
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
        if (
            not content_parts
            and not tool_calls
            and not response_id
            and usage is None
            and finish_reason is None
        ):
            error = self._empty_response_error()
            self._record_event("stream", started_at, error=error)
            raise error
        self._record_event(
            "stream",
            started_at,
            total_tokens=usage.total_tokens if usage else 0,
            response_id=response_id,
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

    async def check_connection(self) -> None:
        """Run a small real inference so the monitor verifies more than HTTP reachability."""
        started_at = perf_counter()
        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[{"role": "user", "content": "仅回复 OK"}],
            )
        except (
            AuthenticationError,
            RateLimitError,
            APITimeoutError,
            APIConnectionError,
            APIStatusError,
        ) as exc:
            error = self._provider_error(exc)
            self._record_event("health_check", started_at, error=error)
            raise error from exc
        try:
            result = self._response_from_completion(response)
        except ModelProviderError as error:
            self._record_event("health_check", started_at, error=error)
            raise
        self._record_event(
            "health_check",
            started_at,
            total_tokens=result.usage.total_tokens if result.usage else 0,
            response_id=result.provider_metadata.get("response_id", ""),
        )

    async def probe_vision(self) -> dict[str, str]:
        """Send a 1x1 PNG to see whether the current model accepts image input."""
        started_at = perf_counter()
        try:
            await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "只回复 OK"},
                            {
                                "type": "image_url",
                                "image_url": {"url": _TINY_PNG_DATA_URL},
                            },
                        ],
                    }
                ],
                max_tokens=8,
            )
        except (
            AuthenticationError,
            RateLimitError,
            APITimeoutError,
            APIConnectionError,
            APIStatusError,
        ) as exc:
            error = self._provider_error(exc)
            self._record_event("health_check", started_at, error=error)
            message = str(exc).lower()
            if _looks_like_vision_rejection(message, getattr(exc, "status_code", None)):
                return {
                    "status": "unsupported",
                    "source": "probe",
                    "detail": "服务拒绝了图片输入，当前模型不支持多模态",
                }
            raise error from exc
        self._record_event("health_check", started_at)
        return {
            "status": "supported",
            "source": "probe",
            "detail": "服务接受了图片输入，当前模型支持多模态",
        }

    async def list_models(self) -> list[str]:
        """Return model IDs exposed by the configured API root's /models endpoint."""
        try:
            page = await self._client.models.list()
            items = list(getattr(page, "data", None) or [])
        except (
            AuthenticationError,
            RateLimitError,
            APITimeoutError,
            APIConnectionError,
            APIStatusError,
        ) as exc:
            raise self._provider_error(exc) from exc
        except (APIError, ValueError, TypeError, AttributeError) as exc:
            # 网关把模型目录指向官网或控制台时会返回 HTML 或缺少 data 的 JSON，
            # SDK 抛出的解析异常必须归一成 ModelProviderError，否则会冒泡成 500。
            raise ModelProviderError(
                "invalid_model_catalog",
                f"模型目录 {self.models_url} 没有返回 OpenAI 兼容的模型列表，"
                "请确认 Base URL 填写的是模型服务的 API 网关地址",
            ) from exc
        return sorted(
            {
                str(item.id).strip()
                for item in items
                if getattr(item, "id", None) and str(item.id).strip()
            }
        )

    @property
    def models_url(self) -> str:
        """The model catalog address actually requested, after base URL normalization."""
        return f"{str(self._client.base_url).rstrip('/')}/models"

    @staticmethod
    def _provider_error(exc: Exception) -> ModelProviderError:
        if isinstance(exc, AuthenticationError):
            return ModelProviderError(
                "authentication_failed",
                "模型服务认证失败，请检查 API Key 是否有效",
            )
        if isinstance(exc, RateLimitError):
            return ModelProviderError(
                "rate_limited",
                "模型服务触发限流，请稍后重试",
                retryable=True,
            )
        if isinstance(exc, APITimeoutError):
            return ModelProviderError(
                "request_timeout",
                "模型服务响应超时，请稍后重试",
                retryable=True,
            )
        if isinstance(exc, APIConnectionError):
            return ModelProviderError(
                "service_unavailable",
                "无法连接模型服务，请检查网关地址或网络状态",
                retryable=True,
            )
        if isinstance(exc, APIStatusError):
            detail = _status_error_detail(exc)
            normalized_detail = detail.lower()
            if any(marker in normalized_detail for marker in _ACCOUNT_POOL_MARKERS):
                return ModelProviderError(
                    "account_pool_exhausted",
                    "模型网关没有可调度的上游账户，请联系服务商检查账户状态、额度或并发限制",
                    retryable=True,
                )
            if exc.status_code == 404 and any(
                marker in normalized_detail for marker in _MODEL_UNAVAILABLE_MARKERS
            ):
                return ModelProviderError(
                    "model_unavailable",
                    f"当前账户组不支持模型 {detail[:160] or '（未知模型）'}",
                )
            if exc.status_code in {404, 405}:
                return ModelProviderError(
                    "route_not_found",
                    "当前地址没有提供 Chat Completions 路由，可检查协议或 API 根路径",
                )
            message = f"模型服务返回异常状态（{exc.status_code}）"
            if detail:
                message = f"{message}：{detail}"
            return ModelProviderError(
                "provider_error",
                message,
                retryable=exc.status_code >= 500,
            )
        return ModelProviderError("provider_error", "模型服务发生未知异常")

    def _record_event(
        self,
        request_kind: str,
        started_at: float,
        *,
        error: ModelProviderError | None = None,
        total_tokens: int = 0,
        response_id: str = "",
    ) -> None:
        try:
            record_model_service_event(
                request_kind=request_kind,
                status="error" if error else "success",
                error_code=error.code if error else "",
                error_message=str(error) if error else "",
                latency_ms=round((perf_counter() - started_at) * 1000),
                total_tokens=total_tokens,
                model_name=self._model,
                base_url=self._base_url,
                response_id=response_id,
                protocol=self.name,
            )
        except Exception:
            # Monitoring is best-effort and must never break a successful model call.
            pass

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
        choices = getattr(response, "choices", None) or []
        if not choices:
            raise self._empty_response_error()
        choice = choices[0]
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

    def _empty_response_error(self) -> ModelProviderError:
        base_url = self._base_url or "OpenAI 官方 API"
        return ModelProviderError(
            "invalid_provider_response",
            (
                "模型服务返回 HTTP 200，但没有符合 Chat Completions 协议的响应内容。"
                f"请确认 Base URL（{base_url}）指向真实 API 根地址，且当前账户支持模型 {self._model}"
            ),
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

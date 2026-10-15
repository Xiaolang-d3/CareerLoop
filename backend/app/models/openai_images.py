"""Non-streaming Images API; never retry a possibly billed generation."""
from __future__ import annotations

from collections.abc import AsyncIterator
from time import perf_counter
from typing import Any

from openai import APIError, APIStatusError

from ..domain import ModelRequest, ModelResponse, ModelStreamEvent, ModelUsage
from ..domain.agent import ModelImageOutput
from ..model_connection import normalize_api_root
from .base import ModelProviderError
from .openai_compatible import OpenAICompatibleProvider


class OpenAIImagesProvider(OpenAICompatibleProvider):
    name = "images"

    @staticmethod
    def _normalize_base_url(base_url: str | None) -> str:
        return normalize_api_root(base_url or "", "images")

    async def generate(self, request: ModelRequest) -> ModelResponse:
        # Selecting an image model alone must not turn a text/diagnostic request
        # into an unexpected paid generation.
        if not request.image_generation:
            raise ModelProviderError("image_prompt_required", "当前选择的是图片模型，请发送明确的生图指令，或切换聊天模型")
        if any(message.payload.get("image_urls") for message in request.messages):
            raise ModelProviderError("image_edit_not_supported", "当前支持文字生图；基于附件的图片编辑尚未接入")
        prompt = next((message.content.strip() for message in reversed(request.messages) if message.role == "user"), "")
        if not prompt:
            raise ModelProviderError("image_prompt_required", "请填写图片描述")
        started_at = perf_counter()
        try:
            # Packy supports n=1 and no streaming/partial_images. Request bytes
            # so results use the account-local asset lifecycle, without fetching
            # arbitrary upstream URLs or exposing expiring links to the client.
            raw = await self._client.with_options(timeout=300, max_retries=0).images.generate(
                model=self._model, prompt=prompt, n=1, size="auto", quality="auto",
                output_format="png", response_format="b64_json",
            )
            result = self._response_from_images(raw)
        except APIError as exc:
            error = self._provider_error(exc)
            error.retryable = False
            self._record_event("generate", started_at, error=error)
            raise error from exc
        except ModelProviderError as error:
            self._record_event("generate", started_at, error=error)
            raise
        except (ValueError, TypeError, AttributeError) as exc:
            error = ModelProviderError("invalid_provider_response", "生图服务返回了无法解析的 Images API 响应；不会自动重新生成")
            self._record_event("generate", started_at, error=error)
            raise error from exc
        self._record_event("generate", started_at, usage=result.usage,
                           total_tokens=result.usage.total_tokens if result.usage else 0)
        return result

    def _response_from_images(self, raw: Any) -> ModelResponse:
        data = getattr(raw, "data", None)
        if not isinstance(data, list) or not data:
            raise ModelProviderError("image_generation_not_executed", "服务没有返回生成的图片，请确认 sora 分组令牌与模型权限；不会自动重新生成")
        if len(data) != 1:
            raise ModelProviderError("invalid_image_output", "生图服务未按 n=1 返回图片；不会自动重新生成")
        encoded = getattr(data[0], "b64_json", None)
        if not isinstance(encoded, str) or not encoded:
            raise ModelProviderError("invalid_image_output", "服务没有按 b64_json 返回图片数据，请检查 Images API 配置；不会自动重新生成")
        if len(encoded) > 28_000_000:
            raise ModelProviderError("invalid_image_output", "生成的图片超过 20 MB；不会自动重新生成")
        raw_usage = getattr(raw, "usage", None)
        usage = None
        if raw_usage is not None:
            usage = ModelUsage(input_tokens=int(getattr(raw_usage, "input_tokens", 0) or 0),
                               output_tokens=int(getattr(raw_usage, "output_tokens", 0) or 0),
                               total_tokens=int(getattr(raw_usage, "total_tokens", 0) or 0))
        return ModelResponse(
            images=[ModelImageOutput(item_id="image-0", base64_data=encoded)],
            output_blocks=[{"type": "image", "index": 0}], usage=usage,
            provider_metadata={"model": self._model, "base_url": self._base_url, "protocol": self.name},
        )

    def _provider_error(self, exc: Exception) -> ModelProviderError:
        if isinstance(exc, APIStatusError) and exc.status_code in {404, 405}:
            return ModelProviderError("route_not_found", "当前地址没有提供 Images API，请检查 /v1/images/generations 与 sora 分组令牌")
        return super()._provider_error(exc)

    async def stream(self, request: ModelRequest) -> AsyncIterator[ModelStreamEvent]:
        # The application can keep its SSE progress connection while the image
        # endpoint receives exactly one ordinary, non-streaming POST.
        yield ModelStreamEvent(type="completed", response=await self.generate(request))

    async def check_connection(self) -> None:
        # Health checks never buy a sample image or call a text endpoint.
        started_at = perf_counter()
        try:
            if self._model not in await self.list_models():
                raise ModelProviderError("model_unavailable", "模型目录未包含当前图片模型，请检查 sora 分组令牌；尚未执行生图")
        except ModelProviderError as error:
            self._record_event("health_check", started_at, error=error)
            raise
        self._record_event("health_check", started_at)

    async def probe_vision(self) -> dict[str, str]:
        return {"status": "unsupported", "source": "client", "detail": "当前 Images 接入仅支持文字生图，未接入图片编辑"}

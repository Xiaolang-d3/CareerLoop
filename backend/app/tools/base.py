from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel

from ..domain import ToolDefinition, ToolResult
from ..registry import NamedRegistry
from ..tooling import TOOL_SPECS, ToolSpec


class ToolContext(BaseModel):
    platform_name: str
    agent_run_id: str | None = None
    conversation_id: int | None = None
    task_id: int | None = None
    user_content: str = ""
    web_search_mode: Literal["auto", "technical", "general"] = "auto"


class ToolHandler(Protocol):
    definition: ToolDefinition

    async def execute(self, arguments: dict, context: ToolContext) -> ToolResult:
        ...


class ToolRegistry(NamedRegistry[ToolHandler]):
    def __init__(self) -> None:
        super().__init__("工具")
        self._specs: dict[str, ToolSpec] = {}

    def register_handler(self, handler: ToolHandler) -> None:
        spec = getattr(handler, "spec", None) or TOOL_SPECS.get(handler.definition.name)
        if spec is None:
            raise ValueError(f"工具缺少 ToolSpec：{handler.definition.name}")
        if spec.name != handler.definition.name:
            raise ValueError(
                f"ToolSpec 名称与工具定义不一致：{spec.name} != {handler.definition.name}"
            )
        self.register(handler.definition.name, handler)
        self._specs[handler.definition.name] = spec

    def definitions(self) -> list[ToolDefinition]:
        return [self.get(name).definition for name in self.names()]

    def spec(self, name: str) -> ToolSpec:
        self.get(name)
        return self._specs[name]

    def specs(self) -> list[ToolSpec]:
        return [self.spec(name) for name in self.names()]

    def names_for_capabilities(self, capabilities: set[str]) -> list[str]:
        if not capabilities:
            return self.names()
        return [
            spec.name
            for spec in self.specs()
            if capabilities & set(spec.capabilities)
        ]

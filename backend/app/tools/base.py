from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel

from ..domain import ToolDefinition, ToolResult
from ..registry import NamedRegistry


class ToolContext(BaseModel):
    platform_name: str
    conversation_id: int | None = None
    task_id: int | None = None
    user_content: str = ""


class ToolHandler(Protocol):
    definition: ToolDefinition

    async def execute(self, arguments: dict, context: ToolContext) -> ToolResult:
        ...


class ToolRegistry(NamedRegistry[ToolHandler]):
    def __init__(self) -> None:
        super().__init__("工具")

    def register_handler(self, handler: ToolHandler) -> None:
        self.register(handler.definition.name, handler)

    def definitions(self) -> list[ToolDefinition]:
        return [self.get(name).definition for name in self.names()]

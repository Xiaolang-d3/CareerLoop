from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolResult
from ..knowledge import search_knowledge
from ..agent_settings import get_agent_settings
from ..domain import ToolError
from .base import ToolContext
from .local_data import invalid_arguments


class SearchLocalKnowledgeArguments(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    source_types: list[Literal["resume", "job", "note"]] = Field(default_factory=list)
    limit: int = Field(default=5, ge=1, le=10)


class SearchLocalKnowledgeTool:
    definition = ToolDefinition(
        name="search_local_knowledge",
        description="在本机保存的脱敏简历、岗位和笔记片段中检索相关证据",
        input_schema=SearchLocalKnowledgeArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if not get_agent_settings(self._db_path)["knowledge_memory_enabled"]:
            message = "本地知识记忆已在 Agent 设置中关闭"
            return ToolResult(ok=False, status="failed", message=message, error=ToolError(code="knowledge_memory_disabled", message=message))
        try:
            payload = SearchLocalKnowledgeArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("本地知识检索参数不合法", exc)
        results = search_knowledge(payload.query, payload.source_types, payload.limit, self._db_path)
        return ToolResult(ok=True, status="done", data={"query": payload.query, "results": results}, message=f"本地找到 {len(results)} 条相关证据")

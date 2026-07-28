from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..agent_settings import get_agent_settings
from ..domain import ToolDefinition, ToolError, ToolResult
from ..knowledge import search_knowledge
from .base import ToolContext
from .local_data import invalid_arguments


class SearchResumeEvidenceArguments(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=5, ge=1, le=10)


class SearchResumeEvidenceTool:
    definition = ToolDefinition(
        name="search_resume_evidence",
        description=(
            "读取并检索当前用户本地保存的脱敏简历片段，用于分析个人优势、"
            "技能、经历、项目、竞争力、简历问题或证明某项能力；"
            "不会搜索本地岗位、互联网或 BOSS 网站"
        ),
        input_schema=SearchResumeEvidenceArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = db_path

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if not get_agent_settings(self._db_path)["knowledge_memory_enabled"]:
            message = "简历证据检索已在 Agent 设置中关闭"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="knowledge_memory_disabled", message=message),
            )
        try:
            payload = SearchResumeEvidenceArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("简历证据检索参数不合法", exc)

        results = search_knowledge(
            payload.query,
            source_types=["resume"],
            limit=payload.limit,
            db_path=self._db_path,
        )
        evidence = [
            {
                "source_type": result.get("source_type"),
                "source_id": result.get("source_id"),
                "title": result.get("title"),
                "excerpt": result.get("content"),
                "similarity": result.get("similarity"),
                "metadata": result.get("metadata", {}),
            }
            for result in results
        ]
        return ToolResult(
            ok=True,
            status="done",
            data={"query": payload.query, "evidence": evidence},
            message=f"从脱敏简历中找到 {len(evidence)} 条相关证据",
        )

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..agent.settings import get_agent_settings
from ..domain import ToolDefinition, ToolError, ToolResult
from ..knowledge import list_knowledge_chunks, search_knowledge
from ..profile.candidate_core import ensure_resume_knowledge_indexed
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
            "技能、经历、项目、竞争力、简历问题或证明某项能力"
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

        # 老数据的简历可能从未建过索引（索引只在画像写入时同步），先补上。
        ensure_resume_knowledge_indexed(self._db_path)
        results = search_knowledge(
            payload.query,
            source_types=["resume"],
            limit=payload.limit,
            db_path=self._db_path,
        )
        match_mode = "similarity"
        if not results:
            # 查询没命中时直接给出简历原文片段，避免模型误判「本地没有简历」。
            results = list_knowledge_chunks(
                source_types=["resume"],
                limit=payload.limit,
                db_path=self._db_path,
            )
            match_mode = "full_document"
        evidence = [
            {
                "source_type": result.get("source_type"),
                "source_id": result.get("source_id"),
                "title": result.get("title"),
                "excerpt": result.get("content"),
                "similarity": result.get("similarity", 0.0),
                "metadata": result.get("metadata", {}),
                "block_id": (result.get("metadata") or {}).get("block_id") or "",
                "block_kind": (result.get("metadata") or {}).get("kind") or "",
            }
            for result in results
        ]
        if not evidence:
            return ToolResult(
                ok=True,
                status="done",
                data={"query": payload.query, "evidence": [], "match_mode": "no_resume"},
                message="本地没有已保存的简历，请提醒用户先在「个人资料」页上传并保存简历",
            )
        message = (
            f"从脱敏简历中找到 {len(evidence)} 条相关证据"
            if match_mode == "similarity"
            else f"查询没有直接命中，已返回已保存简历的 {len(evidence)} 个原文片段"
        )
        return ToolResult(
            ok=True,
            status="done",
            data={"query": payload.query, "evidence": evidence, "match_mode": match_mode},
            message=message,
        )

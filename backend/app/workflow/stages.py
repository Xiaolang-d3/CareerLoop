"""通用资料与创作活动记录；不再推进历史求职阶段。"""
from __future__ import annotations

from ..tooling import TOOL_SPECS

STAGE_DEFS: tuple[tuple[str, str, str], ...] = (
    ("library", "知识库", "导入资料并确认知识"),
    ("creation", "内容创作", "基于资料生成和修改内容"),
    ("research", "公开检索", "按需检索并引用公开来源"),
)
STAGE_IDS = frozenset(stage_id for stage_id, _, _ in STAGE_DEFS)
STAGE_TITLES = {stage_id: title for stage_id, title, _ in STAGE_DEFS}
ROUTE_STAGES: dict[str, str | None] = {
    "conversation": None,
    "library_search": "library",
    "library_update": "library",
    "content_creation": "creation",
    "web_search": "research",
}
TOOL_STAGES = {name: spec.stage_id for name, spec in TOOL_SPECS.items()}
LEGACY_COUNT_KEYS: dict[str, str] = {}


def stage_for_route(kind: str | None) -> str | None:
    return ROUTE_STAGES.get(kind or "")


def stage_for_tool(tool_name: str | None) -> str | None:
    return TOOL_STAGES.get(tool_name or "")

"""候选人画像的文档存储。

画像是一份可读、可手改、可备份的 Markdown 文件，而不是数据库表：

    data/career-profile.md

设计取舍：这里刻意不做事实状态机（待确认/已确认）。文档里的内容就是用户的
画像信息。生成材料前的事实门（``candidate_core.verify_candidate_material``）
改为把声明比对整篇文档正文，不再依赖状态标记。

写入是原子的（临时文件 + ``os.replace``），权限与原先的 SQLite 文件一致
（目录 0700、文件 0600），因为文档里含简历原文。
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator

from .. import db as db_module


DOCUMENT_NAME = "career-profile.md"
DEFAULT_PROFILE_NAME = "候选人"

# 每个小节分配一段 id 区间，行序号即区间内偏移。这样 id 由文档内容直接决定，
# 不需要额外的计数器文件，手改文档后依然能算出同样的 id。
SECTION_ID_STRIDE = 1000

# 文档小节标题 -> 内部字段名。顺序即文件里的呈现顺序。
SECTIONS: tuple[tuple[str, str], ...] = (
    ("目标", "goals"),
    ("经历", "experience"),
    ("项目", "projects"),
    ("技能", "skills"),
    ("成果", "achievements"),
    ("故事", "stories"),
    ("表达偏好", "voice"),
    ("简历原文", "resume_text"),
)

SECTION_BY_TITLE = {title: field for title, field in SECTIONS}
TITLE_BY_SECTION = {field: title for title, field in SECTIONS}

# 小节 <-> 事实类别。保留原先 candidate_facts.category 的取值，让依赖类别筛选的
# 调用方（如 get_candidate_context 的 scope 过滤）不用改。
FACT_CATEGORY_BY_SECTION = {
    "goals": "career_goal",
    "experience": "experience",
    "projects": "project",
    "skills": "skill",
    "achievements": "achievement",
    "stories": "story_seed",
    "voice": "voice_preference",
}

PRIVACY_MODES = {"redacted", "original"}


class ProfileDocument(BaseModel):
    """画像文档的内存表示。正文小节是自由文本，由用户和模型共同维护。"""

    name: str = Field(default=DEFAULT_PROFILE_NAME, max_length=100)
    locale: str = Field(default="zh-CN", max_length=20)
    privacy_mode: str = Field(default="redacted")
    knowledge_revision: int = Field(default=0, ge=0)
    created_at: str = ""
    updated_at: str = ""

    goals: str = ""
    experience: str = ""
    projects: str = ""
    skills: str = ""
    achievements: str = ""
    stories: str = ""
    voice: str = ""
    resume_text: str = ""

    @field_validator("privacy_mode")
    @classmethod
    def _check_privacy_mode(cls, value: str) -> str:
        if value not in PRIVACY_MODES:
            raise ValueError("隐私模式不合法")
        return value

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("称呼不能为空")
        return value.strip()

    def section_text(self) -> str:
        """把画像正文拼成一段语料，供事实门比对声明用。"""
        return "\n".join(getattr(self, field) for _, field in SECTIONS)

    def entries(self, field: str) -> list[str]:
        """把一个小节按行拆成条目，去掉 Markdown 列表符号。"""
        lines = []
        for line in getattr(self, field).splitlines():
            clean = line.strip()
            if not clean or clean == "（待补充）":
                continue
            lines.append(clean.lstrip("-*").strip() or clean)
        return lines

    def facts(self) -> list[dict[str, Any]]:
        """把画像条目暴露成带稳定 id 的事实列表。

        id 由「小节区间 + 行序号」算出，所以同一份文档每次读出的 id 一致，
        手改后也不会错位（除非改动了行的顺序）。
        """
        items: list[dict[str, Any]] = []
        for index, (_, field) in enumerate(SECTIONS):
            if field == "resume_text":
                continue
            base = (index + 1) * SECTION_ID_STRIDE
            for offset, statement in enumerate(self.entries(field), start=1):
                items.append(
                    {
                        "id": base + offset,
                        "category": FACT_CATEGORY_BY_SECTION.get(field, field),
                        "section": field,
                        "statement": statement,
                        "value": {},
                        "sensitivity": "private",
                        "confidence": 1.0,
                        "evidence": [
                            {
                                "source_id": base,
                                "source_title": TITLE_BY_SECTION[field],
                                "excerpt": statement,
                            }
                        ],
                    }
                )
        return items


def document_path(base_dir: str | Path | None = None) -> Path:
    """画像文档路径。``base_dir`` 便于测试隔离，语义对应原先的 ``db_path``。"""
    if base_dir is None:
        # DB_PATH can be redirected by tests and by a local data-directory
        # override.  Resolve it at call time instead of capturing DATA_DIR
        # during module import, so the profile and its SQLite records stay in
        # the same private data directory.
        return db_module.DB_PATH.parent / DOCUMENT_NAME
    resolved = Path(base_dir)
    # 允许直接传文件路径（含 .md 或 .db 后缀时取其所在目录）
    if resolved.suffix:
        return resolved.parent / DOCUMENT_NAME
    return resolved / DOCUMENT_NAME


def exists(base_dir: str | Path | None = None) -> bool:
    return document_path(base_dir).is_file()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def render(document: ProfileDocument) -> str:
    """序列化成 YAML frontmatter + Markdown 小节。"""
    front = {
        "name": document.name,
        "locale": document.locale,
        "privacy_mode": document.privacy_mode,
        "knowledge_revision": document.knowledge_revision,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
    }
    header = yaml.safe_dump(front, allow_unicode=True, sort_keys=False).strip()
    parts = [f"---\n{header}\n---", "", "# 候选人画像", ""]
    for title, field in SECTIONS:
        body = getattr(document, field).strip()
        parts.append(f"## {title}")
        parts.append("")
        parts.append(body if body else "（待补充）")
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def parse(text: str) -> ProfileDocument:
    """从文档文本还原画像。手改过的文件也应当能读回来。"""
    front: dict[str, Any] = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            raw_front = text[3:end]
            body = text[end + 4 :]
            try:
                loaded = yaml.safe_load(raw_front)
                if isinstance(loaded, dict):
                    front = loaded
            except yaml.YAMLError:
                front = {}

    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            title = stripped[3:].strip()
            current = SECTION_BY_TITLE.get(title)
            if current is not None:
                sections.setdefault(current, [])
            continue
        if current is not None:
            sections[current].append(line)

    payload: dict[str, Any] = {
        key: value
        for key, value in front.items()
        if key in {"name", "locale", "privacy_mode", "knowledge_revision", "created_at", "updated_at"}
        and value is not None
    }
    for field, lines in sections.items():
        content = "\n".join(lines).strip()
        payload[field] = "" if content == "（待补充）" else content
    return ProfileDocument.model_validate(payload)


def load(base_dir: str | Path | None = None) -> ProfileDocument | None:
    """读取画像；文件不存在返回 None（对应原先"没有画像"的状态）。"""
    path = document_path(base_dir)
    if not path.is_file():
        return None
    return parse(path.read_text(encoding="utf-8"))


def save(document: ProfileDocument, base_dir: str | Path | None = None) -> ProfileDocument:
    """原子写入，并锁紧权限——文档含简历原文。"""
    path = document_path(base_dir)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass

    stamped = document.model_copy(
        update={
            "created_at": document.created_at or _now(),
            "updated_at": _now(),
            "knowledge_revision": document.knowledge_revision + 1,
        }
    )
    temp_path = path.with_name(f".{path.name}.tmp")
    temp_path.write_text(render(stamped), encoding="utf-8")
    try:
        temp_path.chmod(0o600)
    except OSError:
        pass
    os.replace(temp_path, path)
    return stamped


def delete(base_dir: str | Path | None = None) -> bool:
    """删除画像文档。返回是否真的删掉了文件。"""
    path = document_path(base_dir)
    if not path.is_file():
        return False
    path.unlink()
    return True


def update(
    base_dir: str | Path | None = None,
    **changes: Any,
) -> ProfileDocument:
    """读-改-写。缺失时按默认值新建，便于写入路径直接调用。"""
    current = load(base_dir) or ProfileDocument()
    return save(current.model_copy(update=changes), base_dir)



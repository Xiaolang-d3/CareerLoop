from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal


BlockKind = Literal["project", "work", "education", "skill", "other"]

_SECTION_ALIASES: dict[str, BlockKind] = {
    "项目经历": "project",
    "项目经验": "project",
    "项目实践": "project",
    "projects": "project",
    "工作经历": "work",
    "工作经验": "work",
    "实习经历": "work",
    "experience": "work",
    "employment": "work",
    "教育经历": "education",
    "教育背景": "education",
    "education": "education",
    "专业技能": "skill",
    "技能": "skill",
    "技能特长": "skill",
    "skills": "skill",
}

_HEADING_STOP = {
    "个人信息", "个人简介", "个人优势", "核心优势", "荣誉奖项", "自我评价",
    "求职意向", "基本信息", "联系方式", "resume",
}

_DATE_RE = re.compile(
    r"(?:19|20)\d{2}(?:\s*[\./年\-]\s*(?:0?[1-9]|1[0-2]))?"
    r"(?:\s*[-–—~至到]\s*(?:至今|现在|(?:19|20)\d{2}(?:\s*[\./年\-]\s*(?:0?[1-9]|1[0-2]))?))?"
)
_BULLET_RE = re.compile(r"^[-–—*•●▪◦·]\s+")
_BOLD_RE = re.compile(r"\*\*[^*].+?\*\*|__[^_].+?__")


@dataclass(frozen=True)
class ResumeBlock:
    id: str
    kind: BlockKind
    title: str
    evidence: str
    section: str
    start_date: str = ""
    score: float = 0.0

    def as_dict(self) -> dict[str, str | float]:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "evidence": self.evidence,
            "section": self.section,
            "start_date": self.start_date,
            "score": self.score,
        }


def parse_resume_blocks(text: str) -> list[ResumeBlock]:
    """Split resume text into typed, stably identified blocks.

    Inspired by OpenResume's heading → subsection scoring, but implemented
    independently for Chinese resumes. Does not copy AGPL code.
    """
    lines = [_clean_line(line) for line in (text or "").splitlines()]
    section: BlockKind | None = None
    section_title = ""
    current_kind: BlockKind | None = None
    current_title = ""
    current_lines: list[str] = []
    current_score = 0.0
    blocks: list[ResumeBlock] = []

    def flush() -> None:
        nonlocal current_kind, current_title, current_lines, current_score
        if not current_title and not current_lines:
            return
        title = current_title or (current_lines[0] if current_lines else "简历片段")
        evidence_lines = [current_title, *current_lines] if current_title else list(current_lines)
        evidence = "\n".join(item for item in evidence_lines if item).strip()
        if not evidence:
            current_title = ""
            current_lines = []
            return
        kind = current_kind or section or "other"
        start_date = _first_date(evidence)
        blocks.append(
            ResumeBlock(
                id=stable_block_id(kind, title, start_date, evidence),
                kind=kind,
                title=title[:200],
                evidence=evidence[:4_000],
                section=section_title,
                start_date=start_date,
                score=current_score,
            )
        )
        current_kind = None
        current_title = ""
        current_lines = []
        current_score = 0.0

    for line in lines:
        if not line:
            continue
        heading_kind = _heading_kind(line)
        if heading_kind is not None or _is_stop_heading(line):
            flush()
            section = heading_kind
            section_title = re.split(r"[:：]", line, maxsplit=1)[0].strip()
            remainder = ""
            if "：" in line or ":" in line:
                remainder = re.split(r"[:：]", line, maxsplit=1)[1].strip()
            if remainder:
                current_title = line
                current_kind = heading_kind or "other"
                current_score = 0.0
            continue
        score = title_score(line, section)
        starts_block = score >= 2.0 and not _BULLET_RE.match(line)
        if starts_block:
            flush()
            current_title = _BULLET_RE.sub("", line)
            current_kind = _line_kind(current_title, section)
            current_score = score
            continue
        if current_title or current_lines:
            current_lines.append(line)
        elif section is None:
            current_title = line
            current_kind = "other"
            current_score = 0.0
        else:
            current_title = line
            current_kind = section
            current_score = score

    flush()
    return blocks


def title_score(line: str, section: BlockKind | None) -> float:
    """Score how likely a line is a project/job title rather than a bullet."""
    text = line.strip()
    if not text or _is_stop_heading(text) or _heading_kind(text) is not None:
        return 0.0
    score = 0.0
    if _DATE_RE.search(text):
        score += 2.0
    if _BOLD_RE.search(text):
        score += 1.0
    if 4 <= len(text) <= 40:
        score += 1.0
    if any(token in text for token in ("项目", "系统", "平台", "引擎", "助手", "platform", "system")):
        score += 1.5
    if "｜" in text or "|" in text:
        score += 1.0
    if _BULLET_RE.match(text):
        score -= 2.0
    if section == "project" and not _BULLET_RE.match(text):
        score += 1.0
    if re.fullmatch(r"[\w.+-]+@[\w.-]+", text) or re.fullmatch(r"[\d\s./~-]{6,}", text):
        score -= 3.0
    return score


def stable_block_id(kind: str, title: str, start_date: str, evidence: str) -> str:
    key = "|".join(
        (
            kind,
            re.sub(r"\s+", "", title.casefold()),
            start_date,
            re.sub(r"\s+", "", evidence[:80]),
        )
    )
    digest = hashlib.blake2b(key.encode("utf-8"), digest_size=8).hexdigest()
    return f"{kind}-{digest}"


def _heading_kind(line: str) -> BlockKind | None:
    normalized = line.casefold().rstrip(":：")
    if normalized in _SECTION_ALIASES:
        return _SECTION_ALIASES[normalized]
    for name, kind in _SECTION_ALIASES.items():
        if re.match(rf"^{re.escape(name)}\s*[:：]", line, re.IGNORECASE):
            return kind
    return None


def _is_stop_heading(line: str) -> bool:
    return line.casefold().rstrip(":：") in {item.casefold() for item in _HEADING_STOP}


def _line_kind(title: str, section: BlockKind | None) -> BlockKind:
    if any(token in title for token in ("项目", "系统", "平台", "助手")) and (
        section in {None, "work", "project"}
    ):
        return "project"
    return section or "other"


def _first_date(text: str) -> str:
    match = _DATE_RE.search(text)
    return re.sub(r"\s+", "", match.group(0)) if match else ""


def _clean_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()

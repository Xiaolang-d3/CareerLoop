from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal

from .layout import unwrap_extracted_lines


BlockKind = Literal["project", "work", "education", "skill", "other"]

_SECTION_ALIASES: dict[str, BlockKind] = {
    "项目经历": "project",
    "项目经验": "project",
    "项目实践": "project",
    "projects": "project",
    "工作经历": "work",
    "工作经验": "work",
    "实习经历": "work",
    "实习经验": "work",
    "工作与实习经历": "work",
    "工作与实习经验": "work",
    "工作及实习经历": "work",
    "工作经历与实习": "work",
    "工作与项目经历": "work",
    "工作及项目经历": "work",
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
_WORK_DATE_RANGE_RE = re.compile(
    r"(?:19|20)\d{2}(?:[./年-]\d{1,2}月?)?\s*[-–—~至到]\s*"
    r"(?:(?:19|20)\d{2}(?:[./年-]\d{1,2}月?)?|至今|现在)"
)
_PROJECT_URL_SUFFIX_RE = re.compile(r"\s+(https?://\S+)\s*$", re.I)
_WORK_ROLE_HINT_RE = re.compile(r"工程师|经理|负责人|实习|开发|测试|运营|设计师|研究员|顾问|架构师")
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
    extracted = unwrap_extracted_lines([_clean_line(line) for line in (text or "").splitlines()])
    lines = [part for line in extracted for part in _split_embedded_work_project(line)]
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
        # 工作段里嵌套的项目名标题（如「智能会议总结（Summary）」）拆成独立项目块，
        # 否则项目内容会混进工作块。
        nested_project = section == "work" and _is_project_like_title(line) and not _BULLET_RE.match(line)
        starts_block = score >= 2.0 or nested_project
        if starts_block and not _BULLET_RE.match(line):
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
    normalized = line.casefold().rstrip(":：").strip()
    # 去掉「一、」「1.」这类序号前缀再匹配，PDF/DOCX 提取时很常见
    normalized = re.sub(r"^(?:[一二三四五六七八九十]+|（?\d+）?)[、.．)）]\s*", "", normalized)
    if normalized in _SECTION_ALIASES:
        return _SECTION_ALIASES[normalized]
    for name, kind in _SECTION_ALIASES.items():
        if re.match(rf"^{re.escape(name)}\s*[:：]", line, re.IGNORECASE):
            return kind
    return None


def _is_stop_heading(line: str) -> bool:
    return line.casefold().rstrip(":：") in {item.casefold() for item in _HEADING_STOP}


def _is_project_like_title(line: str) -> bool:
    """项目名标题：短行、无标点，以「（English）」结尾或以常见产品词结尾。"""
    text = _PROJECT_URL_SUFFIX_RE.sub("", line.strip()).strip()
    return (
        bool(text)
        and len(text) <= 80
        and not re.search(r"[，、；。：:]", text)
        and not (_WORK_DATE_RANGE_RE.search(text) and _WORK_ROLE_HINT_RE.search(text))
        and bool(
            re.search(r"[（(][^()（）]*[)）]$", text)
            or re.search(r"(?:项目|平台|系统|工具|助手|应用|引擎|服务|网站|小程序)$", text)
        )
    )


def _split_embedded_work_project(line: str) -> list[str]:
    url_match = _PROJECT_URL_SUFFIX_RE.search(line)
    without_url = line[:url_match.start()].strip() if url_match else line.strip()
    date_match = _WORK_DATE_RANGE_RE.search(without_url)
    if not date_match:
        return [line]

    work_title = without_url[:date_match.end()].strip()
    project_name = without_url[date_match.end():].strip()
    project_title = " ".join(item for item in (project_name, url_match.group(1) if url_match else "") if item)
    if not project_name or not _WORK_ROLE_HINT_RE.search(work_title) or not _is_project_like_title(project_title):
        return [line]
    return [work_title, project_title]


def _line_kind(title: str, section: BlockKind | None) -> BlockKind:
    if _is_project_like_title(title) and section in {None, "work", "project"}:
        return "project"
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

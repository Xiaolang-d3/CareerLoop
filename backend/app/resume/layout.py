from __future__ import annotations

import re
from typing import Any

_SECTION_DEFS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("summary", "个人概述", re.compile(r"^(?:个人简介|个人概述|自我评价|个人总结|简介|个人信息|基本信息)$")),
    ("strengths", "个人优势", re.compile(r"^(?:个人优势|核心优势|个人亮点|能力特长|核心竞争力)$")),
    ("experience", "工作与实习经历", re.compile(r"^(?:工作|职业)(?:[与及和](?:实习|校园))?(?:经历|经验)?$")),
    ("internship", "实习经历", re.compile(r"^实习(?:经历|经验)?$")),
    ("combined", "工作与项目经历", re.compile(r"^(?:工作与项目|工作及项目)(?:经历|经验)?$")),
    ("projects", "项目经历", re.compile(r"^(?:项目(?:经历|经验|实践)?|实践(?:经历|经验)?|项目[／/]实践经历)$")),
    ("skills", "技能", re.compile(r"^(?:专业|核心|技术|相关)?技能(?:与工具)?$")),
    ("education", "教育经历", re.compile(r"^(?:教育)(?:经历|背景)?$")),
    ("campus", "在校经历", re.compile(r"^(?:在校|校园|校内)(?:经历|经验)?$")),
    ("honors", "荣誉证书", re.compile(r"^(?:荣誉证书|荣誉奖项|所获荣誉|获奖经历|证书奖项)$")),
)

_TITLED_CAPABILITY = re.compile(
    r"[「『][^」』]{1,40}[」』]\s*[:：]|[【\[][^】\]]{1,40}[】\]]\s*[:：]|\*{2}[^*]{1,40}能力\*{2}\s*[:：]?"
)
_QUOTED_CAPABILITY = re.compile(r"^[「『]([^」』]{1,40})[」』]\s*[:：]\s*(.*)$")
_BRACKET_CAPABILITY = re.compile(r"^[【\[]([^】\]]{1,40})[】\]]\s*[:：]\s*(.*)$")
_BOLD_CAPABILITY = re.compile(r"^\*{2}([^*]{1,40}能力)\*{2}\s*[:：]?\s*(.*)$")

_HEADING_PREFIX = re.compile(r"^(?:#{1,6}\s*|(?:[一二三四五六七八九十]+|\d+)[、.．)）]\s*)")
_CONTACT_LINE = re.compile(
    r"^(?:电话|手机|邮箱|邮件|微信|地址|住址|联系方式|GitHub|Github)[:：]"
    r"|^[\w.+-]+@[\w.-]+\.\w+$"
    r"|^(?:\+?86[-\s]?)?1[3-9]\d{9}$"
    r"|^(?:https?:\/\/)?(?:www\.)?github\.com\/",
    re.I,
)
_TARGET_LINE = re.compile(r"^(?:求职意向|意向岗位|目标职位|求职目标)[:：]\s*(.*)$")
_DATE_LINE = re.compile(
    r"(?:19|20)\d{2}(?:[./年-]\d{1,2})?(?:\s*[至—-]\s*(?:(?:19|20)\d{2}(?:[./年-]\d{1,2})?|至今|现在))?"
)
_EDUCATION_DATE = re.compile(
    r"(?:19|20)\d{2}(?:[./年-]\d{1,2})?(?:\s*[至—\-~～]\s*(?:(?:19|20)\d{2}(?:[./年-]\d{1,2})?|至今|现在))?"
)
_EDUCATION_AWARD = re.compile(
    r"奖学金|优秀毕业生|优秀学生|三好学生|荣誉称号|荣誉证书|GPA|绩点|CET-?\d|大学英语[四六]级|[四六]级证书|保研资格|学科竞赛"
)
_JAMMED_AWARDS = re.compile(
    r"国家奖学金|校长奖学金|[一二三]等奖学金|校级优秀毕业生|优秀毕业生|三好学生|优秀学生干部|保研资格|CET-?[46]|大学英语[四六]级"
)
_AWARD_LIKE = re.compile(
    r"奖学金|优秀毕业生|优秀学生|三好学生|荣誉称号|荣誉证书|GPA|绩点|CET-?\d|大学英语[四六]级|[四六]级证书|保研资格|学科竞赛"
)
_CONTINUE_TAIL = re.compile(r"[由至到为了在与和及的地得于自按将把被从]$")
_CONTINUE_HEAD = re.compile(
    r"^(?:\d+(?:\.\d+)?(?:\s*(?:%|h|min|ms|倍))?[+＋]?|小时|分钟|[天日点次条个项秒])"
)


def split_resume_layout(text: str) -> dict[str, Any]:
    lines = unwrap_extracted_lines([line.strip() for line in text.splitlines()])
    hash_title = next((line[2:].strip() for line in lines if line.startswith("# ")), "")
    buckets: dict[str, list[str]] = {}
    active = "summary"
    for line in lines:
        heading = _normalize_heading(line)
        matched = next((kind for kind, _label, pattern in _SECTION_DEFS if pattern.match(heading)), None)
        if matched:
            active = matched
            buckets.setdefault(active, [])
            continue
        if line.startswith("# "):
            continue
        if not line and active not in buckets:
            continue
        buckets.setdefault(active, []).append(line)

    kept, peeled = _peel_strength_lines(buckets.get("summary", []))
    buckets["summary"] = kept
    if peeled:
        buckets["strengths"] = [*peeled, *buckets.get("strengths", [])]

    sections: list[dict[str, Any]] = []
    for kind, label, _pattern in _SECTION_DEFS:
        raw_lines = buckets.get(kind, [])
        if kind == "combined":
            experience, projects = _split_combined_work_and_projects(raw_lines)
            if experience:
                sections.append({"kind": "experience", "label": "工作经历", "entries": experience})
            if projects:
                sections.append({"kind": "projects", "label": "项目经历", "entries": projects})
            continue
        if kind in {"experience", "internship"}:
            experience, projects = _split_combined_work_and_projects(raw_lines)
            if experience:
                sections.append({"kind": kind, "label": label, "entries": experience})
            if projects:
                sections.append({"kind": "projects", "label": "项目经历", "entries": projects})
            continue
        entries = _split_section_entries(kind, raw_lines)
        if entries:
            sections.append({"kind": kind, "label": label, "entries": entries})
    if not sections and any(line for line in lines if not line.startswith("# ")):
        leftover = [line for line in lines if line and not line.startswith("# ")]
        sections = [{"kind": "other", "label": "简历内容", "entries": _split_entries(leftover)}]

    title, contact, target, sections = _extract_header(hash_title, sections)
    sections = _drop_duplicate_title_sections(title, sections)
    contact = [item for item in contact if not _is_duplicate_title_line(title, item)]

    sidebar = [section for section in sections if section["kind"] in {"skills", "education"}]
    main = [section for section in sections if section["kind"] not in {"skills", "education"}]
    if not sidebar and any(section["kind"] == "summary" for section in main) and len(main) > 1:
        sidebar = [section for section in main if section["kind"] == "summary"]
        main = [section for section in main if section["kind"] != "summary"]
    return {
        "title": title,
        "contact": contact,
        "target": target,
        "sidebar": sidebar,
        "main": main,
        "sections": sections,
    }


def skill_tags(entries: list[list[str]]) -> list[str]:
    tags: list[str] = []
    for entry in entries:
        for line in entry:
            for item in re.split(r"[、，,；;｜|/]+", line):
                clean = item.strip()
                if clean:
                    tags.append(clean)
    return tags[:24]


_DATE_CORE = (
    r"(?:19|20)\d{2}(?:[./年-]\d{1,2}月?)?"
    r"(?:\s*[至—\-~～-]\s*(?:(?:19|20)\d{2}(?:[./年-]\d{1,2}月?)?|至今|现在))?"
)
_TRAILING_DATE = re.compile(rf"[\s|｜/／]+({_DATE_CORE})\s*$")
_LEADING_DATE = re.compile(rf"^({_DATE_CORE})[\s|｜/／]+(.+)$")
_DATE_ONLY = re.compile(rf"^{_DATE_CORE}$")


def split_entry_heading(line: str) -> tuple[str, str]:
    """Split '公司｜职位 2024.01-2025.06' or a leading date into (title, date)."""
    value = line.strip()
    if not value:
        return "", ""
    trailing = _TRAILING_DATE.search(value)
    if trailing and trailing.start() >= 2:
        title = value[: trailing.start()].rstrip(" |｜/／")
        if title:
            return title, trailing.group(1).strip()
    leading = _LEADING_DATE.match(value)
    if leading:
        return leading.group(2).strip(), leading.group(1).strip()
    return value, ""


def split_document_name(title: str) -> tuple[str, str]:
    """Split '陈露鑫｜AI 应用工程师' into (name, role). Dates on the right stay in the name."""
    value = title.strip()
    for separator in ("｜", "|"):
        if separator not in value:
            continue
        name, rest = (part.strip() for part in value.split(separator, 1))
        if name and rest and not _DATE_ONLY.match(rest):
            return name, rest
    return value, ""


def contact_link_target(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    if re.fullmatch(r"[\w.+-]+@[\w.-]+\.\w+", text):
        return f"mailto:{text}"
    url = text
    if re.match(r"^(?:电话|手机|邮箱|邮件|微信|地址|住址|联系方式|GitHub|Github)[:：]", text, re.I):
        url = re.sub(r"^[^:：]+[:：]\s*", "", text).strip()
    if re.fullmatch(r"[\w.+-]+@[\w.-]+\.\w+", url):
        return f"mailto:{url}"
    if re.match(r"^https?://", url, re.I):
        return url
    if re.match(r"^(?:www\.)?github\.com/", url, re.I):
        return f"https://{url.removeprefix('https://').removeprefix('http://')}"
    return ""


def unwrap_extracted_lines(lines: list[str]) -> list[str]:
    merged: list[str] = []
    for line in lines:
        previous = merged[-1] if merged else ""
        if previous and _should_join_extracted_lines(previous, line):
            merged[-1] = _join_extracted_lines(previous, line)
        else:
            merged.append(line)
    return merged


def titles_overlap(left: str, right: str) -> bool:
    first = _title_name(left)
    second = _title_name(right)
    return bool(first and second and (first == second or first.startswith(second) or second.startswith(first)))


def leading_title(text: str) -> str:
    for line in text.splitlines():
        clean = line.strip()
        if not clean:
            continue
        if clean.startswith("# "):
            return clean[2:].strip()
        if clean.startswith("## "):
            return ""
        if _looks_like_document_title(clean):
            return clean
        return ""
    return ""


def strip_leading_title(text: str) -> str:
    lines = text.splitlines()
    skipped = False
    kept: list[str] = []
    for line in lines:
        if not skipped and line.strip():
            skipped = True
            continue
        kept.append(line)
    return "\n".join(kept).strip()


def strip_duplicate_name_prefix(text: str, title: str) -> str:
    if not title or not text:
        return text
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        clean = lines[index].strip()
        if not clean or _is_duplicate_title_line(title, clean):
            index += 1
            continue
        break
    return "\n".join(lines[index:]).strip()


def compose_rendered_sections(sections: list[str]) -> str:
    merged: list[str] = []
    first_title = ""
    for section in sections:
        text = section.strip()
        if not text:
            continue
        title = leading_title(text)
        if first_title and title and titles_overlap(first_title, title):
            text = strip_leading_title(text)
            text = strip_duplicate_name_prefix(text, first_title)
            if not text:
                continue
        elif title and not first_title:
            first_title = title
        merged.append(text)
    return "\n\n".join(merged)


def _title_name(value: str) -> str:
    return value.replace("# ", "", 1).split("｜", 1)[0].split("|", 1)[0].strip()


def _looks_like_document_title(line: str) -> bool:
    if not line or len(line) > 42 or re.search(r"[。！？]", line):
        return False
    if line.startswith("- ") or _is_contact_line(line) or _TARGET_LINE.match(line):
        return False
    if _normalize_heading(line) and any(pattern.match(_normalize_heading(line)) for _kind, _label, pattern in _SECTION_DEFS):
        return False
    return True


def _normalize_heading(value: str) -> str:
    text = _HEADING_PREFIX.sub("", value).replace("／", "/").replace(" :", "").rstrip("：:")
    return text


def _is_cjk(character: str) -> bool:
    return "\u4e00" <= character <= "\u9fff"


def _is_heading_line(line: str) -> bool:
    heading = _normalize_heading(line)
    if any(pattern.match(heading) for _kind, _label, pattern in _SECTION_DEFS):
        return True
    return bool(re.match(r"^#{2,6}\s+\S", line.strip()))


def _is_contact_line(line: str) -> bool:
    value = line.strip()
    if not value or _is_profile_cert_line(value):
        return False
    if _CONTACT_LINE.match(value):
        return True
    return len(value) <= 80 and bool(re.search(r"[｜|].+@", value))


def _is_profile_cert_line(line: str) -> bool:
    value = line.strip()
    if not value:
        return False
    if re.match(r"^(?:英语|日语|普通话|语言)[:：]", value):
        return True
    return bool(_AWARD_LIKE.search(value) and len(value) <= 40 and not _looks_like_school_line(value))


def _looks_like_school_line(line: str) -> bool:
    return bool(
        re.search(r"(?:大学|学院|学校|中学|高中|University|College)", line, re.I)
        and (re.search(r"(?:19|20)\d{2}", line) or re.search(r"[|｜]", line) or len(line) <= 32)
    )


def _is_award_like_line(line: str) -> bool:
    return bool(_AWARD_LIKE.search(line) and not re.search(r"(?:大学|学院|学校|University|College)", line, re.I))


_WORK_DATE_RANGE = re.compile(
    r"(?:19|20)\d{2}(?:[./年-]\d{1,2}月?)?\s*[至—\-~～]\s*"
    r"(?:(?:19|20)\d{2}(?:[./年-]\d{1,2}月?)?|至今|现在)"
)
_PROJECT_URL_SUFFIX = re.compile(r"\s+(https?://\S+)\s*$", re.I)
_WORK_ROLE_HINT = re.compile(r"工程师|经理|负责人|实习|开发|测试|运营|设计师|研究员|顾问|架构师")


def _project_title_core(line: str) -> str:
    return _PROJECT_URL_SUFFIX.sub("", line.strip()).strip()


def _is_project_title(line: str) -> bool:
    value = _project_title_core(line)
    return (
        len(value) <= 80
        and not re.search(r"[，、；。：:]", value)
        and not (_WORK_DATE_RANGE.search(value) and _WORK_ROLE_HINT.search(value))
        and bool(re.search(r"[（(][^()（）]+[)）]$", value) or re.search(r"(项目|平台|系统|工具|助手|应用|引擎|服务|网站|小程序)$", value))
    )


def _is_work_title(line: str) -> bool:
    if not line or re.match(r"^(?:[-–—*•●▪◦·]\s*)", line):
        return False
    match = _WORK_DATE_RANGE.search(line)
    if not match:
        return False
    title = re.sub(r"[|｜/／\s-]+$", "", line[:match.start()] + line[match.end():]).strip()
    return bool(title) and not _is_project_title(title)


def _split_embedded_work_project(line: str) -> list[str]:
    url_match = _PROJECT_URL_SUFFIX.search(line)
    without_url = line[:url_match.start()].strip() if url_match else line.strip()
    date_match = _WORK_DATE_RANGE.search(without_url)
    if not date_match:
        return [line]

    work_title = without_url[:date_match.end()].strip()
    project_name = without_url[date_match.end():].strip()
    project_title = " ".join(item for item in (project_name, url_match.group(1) if url_match else "") if item)
    if not _is_work_title(work_title) or not project_name or not _is_project_title(project_title):
        return [line]
    return [work_title, project_title]


def _should_join_extracted_lines(previous: str, current: str) -> bool:
    if not previous or not current:
        return False
    if previous.startswith("# ") or current.startswith("# "):
        return False
    if _is_heading_line(previous) or _is_heading_line(current):
        return False
    if _is_work_title(previous) or _PROJECT_URL_SUFFIX.search(previous):
        return False
    if _is_titled_capability(current):
        return False
    if _is_titled_capability(previous):
        if _is_heading_line(current) or _is_contact_line(current) or _TARGET_LINE.match(current):
            return False
        if previous.endswith(("。", "！", "？", "!", "?")):
            return False
        return len(previous) >= 16
    if _is_project_title(previous) or re.search(r"[|｜]", previous):
        return False
    if _looks_like_school_line(previous) or _is_award_like_line(previous) or _is_award_like_line(current):
        return False
    if re.match(r"^(?:[-–—*•●▪◦·]\s*|\d{1,2}[.、)]\s+|\d{4}\s*[./年-])", current):
        return False
    if re.match(r"^.{1,16}[:：]", previous) or re.match(r"^.{1,16}[:：]", current):
        return False
    if previous.endswith(("，", "、", ",", "；")):
        return True
    if previous.endswith(("。", "！", "？", "：", ":", ";", "!", "?")):
        return False
    if _CONTINUE_TAIL.search(previous) and not _is_heading_line(current):
        return True
    if _CONTINUE_HEAD.match(current) and not _is_project_title(previous):
        return True
    return len(previous) >= 16


def _join_extracted_lines(previous: str, current: str) -> str:
    left, right = previous[-1], current[0]
    if previous.endswith(","):
        return previous + current if current[:1].isspace() else f"{previous} {current}"
    if _is_cjk(left) and _is_cjk(right):
        return previous + current
    if left.isalnum() and right.isalnum():
        return f"{previous} {current}"
    if _is_cjk(left) and right.isascii() and right.isalnum():
        return f"{previous} {current}"
    if left.isascii() and left.isalnum() and _is_cjk(right):
        return f"{previous} {current}"
    return previous + current


def _split_entries(lines: list[str]) -> list[list[str]]:
    entries: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        if not line:
            if current:
                entries.append(current)
                current = []
            continue
        if _DATE_LINE.search(line) and len(current) > 1:
            entries.append(current)
            current = [line]
            continue
        current.append(line)
    if current:
        entries.append(current)
    return entries


def _split_project_entries(lines: list[str]) -> list[list[str]]:
    projects: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        if not line:
            if current:
                projects.append(current)
                current = []
            continue
        if current and _is_project_title(line):
            projects.append(current)
            current = [line]
            continue
        current.append(line)
    if current:
        projects.append(current)
    return projects


def _split_combined_work_and_projects(lines: list[str]) -> tuple[list[list[str]], list[list[str]]]:
    expanded = [part for line in lines for part in _split_embedded_work_project(line)]
    if not any(_is_project_title(line) for line in expanded):
        return _split_entries(lines), []

    experience: list[list[str]] = []
    projects: list[list[str]] = []
    kind = "experience"
    current: list[str] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        (projects if kind == "projects" else experience).append(current)
        current = []

    for line in expanded:
        if not line:
            flush()
            continue
        if _is_work_title(line):
            flush()
            kind = "experience"
            current = [line]
            continue
        if _is_project_title(line):
            flush()
            kind = "projects"
            current = [line]
            continue
        current.append(line)
    flush()
    return experience, projects


def _split_award_items(text: str) -> list[str]:
    delimited = [item.strip() for item in re.split(r"[、，,；;]+", text) if item.strip()]
    if len(delimited) > 1:
        return delimited
    matches = list(_JAMMED_AWARDS.finditer(text))
    if len(matches) < 2:
        return delimited
    parts: list[str] = []
    cursor = 0
    for match in matches:
        gap = text[cursor:match.start()].strip()
        if gap:
            parts.append(gap)
        parts.append(match.group(0))
        cursor = match.end()
    tail = text[cursor:].strip()
    if tail:
        parts.append(tail)
    return [item for item in parts if item]


def _split_education_line(line: str) -> list[str]:
    date_match = _EDUCATION_DATE.search(line)
    if date_match:
        rest = re.sub(r"^[\s|｜/／、，,；;]+", "", line[date_match.end():]).strip()
        if rest and _EDUCATION_AWARD.search(rest):
            heading = line[: date_match.end()].strip()
            if heading:
                return [heading, *_split_award_items(rest)]
    if _looks_like_school_line(line) and _EDUCATION_AWARD.search(line):
        award_match = _EDUCATION_AWARD.search(line)
        if award_match and award_match.start() >= 4:
            heading = re.sub(r"[\s|｜/／、，,；;]+$", "", line[: award_match.start()]).strip()
            rest = line[award_match.start():].strip()
            if heading and rest:
                return [heading, *_split_award_items(rest)]
    if _is_award_like_line(line) and re.search(r"[、，,；;]", line):
        return _split_award_items(line)
    return [line]


def _split_education_entries(lines: list[str]) -> list[list[str]]:
    return [
        expanded if expanded else entry
        for entry in _split_entries(lines)
        for expanded in [ [item for line in entry for item in _split_education_line(line)] ]
    ]


def _split_section_entries(kind: str, lines: list[str]) -> list[list[str]]:
    if kind == "projects":
        return _split_project_entries(lines)
    if kind == "education":
        return _split_education_entries(lines)
    if kind == "strengths":
        return _split_strength_entries(lines)
    return _split_entries(lines)


def _is_titled_capability(line: str) -> bool:
    return bool(_TITLED_CAPABILITY.match(line.strip()))


def _split_titled_chunks(text: str) -> list[str]:
    value = text.strip()
    if not value:
        return []
    starts = [match.start() for match in _TITLED_CAPABILITY.finditer(value)]
    if not starts:
        return [text]
    chunks: list[str] = []
    if starts[0] > 0:
        prefix = value[: starts[0]].strip()
        if prefix:
            chunks.append(prefix)
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(value)
        chunk = value[start:end].strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def _parse_titled_capability(line: str) -> list[str] | None:
    value = line.strip()
    quoted = _QUOTED_CAPABILITY.match(value)
    if quoted:
        title, body = f"「{quoted.group(1)}」", quoted.group(2).strip()
        return [title, body] if body else [title]
    bracket = _BRACKET_CAPABILITY.match(value)
    if bracket:
        title, body = f"【{bracket.group(1)}】", bracket.group(2).strip()
        return [title, body] if body else [title]
    bold = _BOLD_CAPABILITY.match(value)
    if bold:
        title, body = bold.group(1), bold.group(2).strip()
        return [title, body] if body else [title]
    return [value] if _is_titled_capability(value) else None


def _is_strength_body_line(line: str) -> bool:
    value = line.strip()
    if not value or _is_titled_capability(value) or _is_heading_line(value):
        return False
    if _is_contact_line(value) or _TARGET_LINE.match(value):
        return False
    if _looks_like_school_line(value) or _is_award_like_line(value) or _is_project_title(value):
        return False
    return True


def _next_non_empty_index(lines: list[str], start: int) -> int:
    for index in range(start, len(lines)):
        if lines[index]:
            return index
    return -1


def _peel_strength_lines(lines: list[str]) -> tuple[list[str], list[str]]:
    expanded = [chunk for line in lines for chunk in (_split_titled_chunks(line) if line else [line])]
    kept: list[str] = []
    strengths: list[str] = []
    index = 0
    while index < len(expanded):
        if _is_titled_capability(expanded[index]):
            strengths.append(expanded[index])
            index += 1
            while index < len(expanded):
                line = expanded[index]
                if _is_titled_capability(line):
                    strengths.append(line)
                    index += 1
                    continue
                if not line:
                    nxt = _next_non_empty_index(expanded, index + 1)
                    if nxt >= 0 and (
                        _is_titled_capability(expanded[nxt]) or _is_strength_body_line(expanded[nxt])
                    ):
                        strengths.append(line)
                        index += 1
                        continue
                    break
                if _is_strength_body_line(line):
                    previous = strengths[-1] if strengths else ""
                    parsed = _parse_titled_capability(previous) if previous else None
                    if parsed and len(parsed) == 1:
                        strengths.append(line)
                        index += 1
                        continue
                    break
                break
            continue
        kept.append(expanded[index])
        index += 1
    return kept, strengths


def _split_strength_entries(lines: list[str]) -> list[list[str]]:
    expanded = [chunk for line in lines for chunk in (_split_titled_chunks(line) if line else [line])]
    if not any(_is_titled_capability(line) for line in expanded):
        return _split_entries(expanded)
    entries: list[list[str]] = []
    current: list[str] = []
    for line in expanded:
        titled = _parse_titled_capability(line) if line else None
        if titled:
            if current:
                entries.append(current)
            current = titled
            continue
        if not line:
            if current:
                entries.append(current)
                current = []
            continue
        if current:
            current.append(line)
        else:
            current = [line]
    if current:
        entries.append(current)
    return entries


def _extract_header(
    hash_title: str,
    sections: list[dict[str, Any]],
) -> tuple[str, list[str], str, list[dict[str, Any]]]:
    title = hash_title
    contact: list[str] = []
    targets: list[str] = []
    if sections and sections[0]["kind"] == "summary":
        peeled_contact, peeled_targets, kept = _peel_profile_lines(sections[0]["entries"])
        contact.extend(peeled_contact)
        targets.extend(peeled_targets)
        sections[0]["entries"] = kept
        if not kept:
            sections.pop(0)

    if not title and sections:
        first = sections[0]["entries"][0][0] if sections[0]["entries"] else ""
        if first and _looks_like_document_title(first):
            title = first
            rest = sections[0]["entries"][0][1:]
            if rest:
                sections[0]["entries"][0] = rest
            else:
                sections[0]["entries"].pop(0)
            if not sections[0]["entries"]:
                sections.pop(0)

    if sections and sections[0]["kind"] == "summary" and title:
        sections[0]["entries"] = _drop_duplicate_title_entries(title, sections[0]["entries"])
        if not sections[0]["entries"]:
            sections.pop(0)

    target = targets[0] if targets else ""
    return title, contact, target, sections


def _peel_profile_lines(
    entries: list[list[str]],
) -> tuple[list[str], list[str], list[list[str]]]:
    contact: list[str] = []
    targets: list[str] = []
    kept: list[list[str]] = []
    for entry in entries:
        kept_lines: list[str] = []
        for line in entry:
            target_match = _TARGET_LINE.match(line)
            if target_match:
                targets.append((target_match.group(1) or line).strip())
                continue
            if _is_contact_line(line):
                contact.append(line)
                continue
            kept_lines.append(line)
        if kept_lines:
            kept.append(kept_lines)
    return contact, targets, kept


def _is_duplicate_title_line(title: str, line: str) -> bool:
    clean = re.sub(r"^#\s*", "", line).strip()
    name = _title_name(title)
    return bool(title) and clean in {title, name} and bool(clean)


def _drop_duplicate_title_entries(title: str, entries: list[list[str]]) -> list[list[str]]:
    cleaned: list[list[str]] = []
    for entry in entries:
        lines = [line for line in entry if not _is_duplicate_title_line(title, line)]
        if lines:
            cleaned.append(lines)
    return cleaned


def _drop_duplicate_title_sections(title: str, sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not title:
        return sections
    cleaned: list[dict[str, Any]] = []
    for section in sections:
        entries = _drop_duplicate_title_entries(title, section.get("entries") or [])
        if entries:
            cleaned.append({**section, "entries": entries})
    return cleaned

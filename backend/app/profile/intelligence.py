from __future__ import annotations

import re
from typing import Any

from ..resume.blocks import ResumeBlock, parse_resume_blocks


SKILL_ALIASES: dict[str, tuple[str, ...]] = {
    "Python": ("python",), "Java": ("java",), "JavaScript": ("javascript", "js"),
    "TypeScript": ("typescript", "ts"), "React": ("react",), "Vue": ("vue", "vue.js"),
    "FastAPI": ("fastapi",), "Django": ("django",), "Spring Boot": ("spring boot", "springboot"),
    "SQL": ("sql",), "MySQL": ("mysql",), "PostgreSQL": ("postgresql", "postgres"),
    "Redis": ("redis",), "Docker": ("docker",), "Kubernetes": ("kubernetes", "k8s"),
    "Linux": ("linux",), "Git": ("git",), "AWS": ("aws",), "Azure": ("azure",),
    "LLM": ("llm", "大语言模型"), "RAG": ("rag", "检索增强"), "Agent": ("agent", "智能体"),
    "LangChain": ("langchain",), "LangGraph": ("langgraph",), "PyTorch": ("pytorch", "torch"),
    "TensorFlow": ("tensorflow",), "机器学习": ("机器学习",), "深度学习": ("深度学习",),
    "产品设计": ("产品设计",), "数据分析": ("数据分析",), "项目管理": ("项目管理",),
}

PROFILE_LABELS: dict[str, tuple[str, ...]] = {
    "name": ("姓名", "名字", "name"),
    "target_roles": ("求职意向", "求职目标", "期望职位", "目标岗位", "应聘岗位", "职位目标"),
    "target_cities": ("期望城市", "目标城市", "意向城市", "工作地点", "期望地点", "期望工作地点"),
}


def extract_skills(text: str, *, blocked: Any = None) -> list[str]:
    lowered = text.lower()
    found: list[str] = []
    for canonical, aliases in SKILL_ALIASES.items():
        if any(_contains(lowered, alias.lower()) for alias in aliases):
            found.append(canonical)
    return filter_blocked_skills(found, blocked)


_SKILL_LEAD_RE = re.compile(
    r"^(?:熟练掌握|熟练使用|具备|擅长|熟悉|精通|掌握|了解)\s*"
)
_SKILL_TAG_SPLIT_RE = re.compile(r"[，,、/|;；]+")
_SKILL_AND_RE = re.compile(r"[与和]")
_SKILL_TAG_MAX_LEN = 16


def extract_skill_tags(text: str, *, blocked: Any = None) -> list[str]:
    """Turn resume skill dumps into short tags. Does not invent names."""
    found = list(extract_skills(text))
    seen = {item.casefold() for item in found}
    for tag in _skill_tag_candidates(text):
        key = tag.casefold()
        if key in seen or _skill_tag_covered(key, seen):
            continue
        seen.add(key)
        found.append(tag)
    return filter_blocked_skills(found, blocked)


def _skill_tag_candidates(text: str) -> list[str]:
    tags: list[str] = []
    for chunk in _skill_source_chunks(text):
        headed = bool(_SKILL_HEADING_RE.match(chunk))
        rest = _SKILL_HEADING_RE.sub("", chunk).strip()
        lead = _SKILL_LEAD_RE.match(rest)
        if not headed and not lead and not _looks_like_skill_list(rest):
            if _looks_like_tech_token(rest):
                tag = normalize_skill_tag(rest)
                if tag:
                    tags.append(tag)
            continue
        if lead:
            rest = rest[lead.end():]
        rest = rest.rstrip("。！？.;； ")
        for part in _SKILL_TAG_SPLIT_RE.split(rest):
            for piece in _expand_skill_parts(part):
                for fragment in _split_skill_lead_fragments(piece):
                    tag = normalize_skill_tag(fragment)
                    if tag:
                        tags.append(tag)
    return tags


def _skill_source_chunks(text: str) -> list[str]:
    chunks: list[str] = []
    for raw in str(text or "").splitlines():
        line = raw.strip().lstrip("-•·* ").strip()
        if not line:
            continue
        parts = [part.strip() for part in re.split(r"[，,]", line) if part.strip()]
        if len(parts) > 1 and any(
            _SKILL_LEAD_RE.match(part) or _SKILL_HEADING_RE.match(part) for part in parts
        ):
            chunks.extend(parts)
            continue
        if len(parts) > 1 and all(len(part) <= _SKILL_TAG_MAX_LEN for part in parts):
            chunks.extend(parts)
            continue
        chunks.append(line)
    return chunks


def _looks_like_tech_token(line: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z][A-Za-z0-9.+#/\-]{0,15}", line.strip()))


def _looks_like_skill_list(line: str) -> bool:
    separators = sum(line.count(mark) for mark in ("、", "，", ",", "/", "|"))
    return separators >= 2 and not _ACTION_RE.search(line) and not _METRIC_RE.search(line)


def _expand_skill_parts(part: str) -> list[str]:
    pieces = [item.strip() for item in _SKILL_AND_RE.split(part) if item.strip()]
    if len(pieces) >= 2 and all(1 < len(item) <= 8 for item in pieces):
        return pieces
    return [part]


def _split_skill_lead_fragments(part: str) -> list[str]:
    fragments = [
        item.strip()
        for item in re.split(
            r"(?:熟练掌握|熟练使用|具备|擅长|熟悉|精通|掌握|了解)\s*",
            part,
        )
        if item.strip()
    ]
    return fragments or [part]


def normalize_skill_tag(part: str) -> str:
    tag = part.strip().strip("的了 ").removesuffix("能力").removesuffix("相关经验").strip()
    if not tag or len(tag) > _SKILL_TAG_MAX_LEN:
        return ""
    if re.search(r"[。！？]", tag):
        return ""
    if _SKILL_LEAD_RE.match(tag):
        return ""
    if _ACTION_RE.search(tag) and len(tag) > 8:
        return ""
    return tag


def short_skill_tag(part: str) -> str:
    """Unwrap inbox/resume wrappers into a short tag, or empty if it is not a tag."""
    text = " ".join(str(part or "").split())
    if not text:
        return ""
    for _ in range(3):
        stripped = _SKILL_LEAD_RE.sub("", text).strip()
        if stripped == text:
            break
        text = stripped
    text = re.sub(r"\s+相关经验$", "", text).strip()
    return normalize_skill_tag(text)


def blocked_skill_keys(blocked: Any = None) -> set[str]:
    keys: set[str] = set()
    for raw in blocked or []:
        text = " ".join(str(raw or "").split())
        if not text:
            continue
        tag = short_skill_tag(text) or normalize_skill_tag(text) or text
        keys.add(tag.casefold())
        keys.add(text.casefold())
        for canonical, aliases in SKILL_ALIASES.items():
            names = (canonical, *aliases)
            if any(tag.casefold() == name.casefold() or text.casefold() == name.casefold() for name in names):
                keys.update(name.casefold() for name in names)
    return keys


def skill_is_blocked(skill: str, blocked: Any = None) -> bool:
    keys = blocked if isinstance(blocked, set) else blocked_skill_keys(blocked)
    if not keys:
        return False
    tag = short_skill_tag(skill) or normalize_skill_tag(skill) or str(skill or "").strip()
    if tag.casefold() in keys or str(skill or "").strip().casefold() in keys:
        return True
    for canonical, aliases in SKILL_ALIASES.items():
        names = (canonical, *aliases)
        if tag.casefold() != canonical.casefold() and all(tag.casefold() != alias.casefold() for alias in aliases):
            continue
        if any(name.casefold() in keys for name in names):
            return True
    return False


def filter_blocked_skills(skills: list[str], blocked: Any = None) -> list[str]:
    keys = blocked_skill_keys(blocked)
    found: list[str] = []
    seen: set[str] = set()
    for raw in skills:
        tag = str(raw or "").strip()
        if not tag:
            continue
        key = tag.casefold()
        if key in seen or skill_is_blocked(tag, keys):
            continue
        seen.add(key)
        found.append(tag)
    return found


def _skill_tag_covered(tag: str, existing: set[str]) -> bool:
    return any(_contains(tag, item) for item in existing if len(item) >= 3)


def suggest_profile_fields(text: str) -> dict[str, Any]:
    """Extract conservative, locally computed profile suggestions from resume text."""
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    name = _labeled_value(lines, PROFILE_LABELS["name"])
    if not name and lines:
        first = lines[0].strip("-—|· ")
        if _looks_like_name(first):
            name = first
    return {
        "name": name,
        "target_roles": _split_suggestions(_labeled_value(lines, PROFILE_LABELS["target_roles"])),
        "target_cities": _split_suggestions(_labeled_value(lines, PROFILE_LABELS["target_cities"])),
        "skills": extract_skill_tags(text),
    }


_RESUME_SECTIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("教育经历", ("教育经历", "教育背景", "education")),
    ("工作经历", ("工作经历", "工作经验", "实习经历", "experience")),
    ("项目经历", ("项目经历", "项目经验", "项目实践", "projects")),
    ("专业技能", ("专业技能", "技能", "skills")),
    ("自我评价", ("自我评价", "个人简介", "summary")),
)
_PROJECT_HEADINGS = {"项目经历", "项目经验", "项目实践", "projects"}
_WORK_HEADINGS = {"工作经历", "工作经验", "实习经历", "experience"}
_SECTION_HEADING_KEYS = frozenset(
    alias.casefold() for _, aliases in _RESUME_SECTIONS for alias in aliases
)
_SCAN_MODULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("教育", ("教育经历", "教育背景", "education")),
    ("工作", ("工作经历", "工作经验", "实习经历", "experience")),
    ("项目", ("项目经历", "项目经验", "项目实践", "projects")),
    ("技能", ("专业技能", "技能", "skills")),
)
_METRIC_RE = re.compile(
    r"\d+(?:\.\d+)?\s*%|"
    r"\d[\d,.]*\s*(?:万|亿|人|用户|小时|倍|次|条|个|项|家|天|周|月|年|QPS|qps|ms|秒)|"
    r"(?:降低|提升|增长|缩短|减少|提高)\s*\d"
)
_ACTION_RE = re.compile(
    r"负责|主导|独立|完成|实现|开发|设计|优化|搭建|落地|编写|重构|排查|上线|部署|接入|参与|推动"
)
_OWNERSHIP_RE = re.compile(r"负责|主导|独立|带队|owner")
_COLLAB_RE = re.compile(r"协作|配合|跨组|跨端|评审|对接")
_SCALE_RE = re.compile(r"\d[\d,.]*\s*(?:万|亿|人|用户|QPS|qps|并发|节点|台|条)|百万|千万")
_SKILL_HEADING_RE = re.compile(r"^(?:专业技能|技能清单|技能|skills)\s*[:：]?\s*", re.IGNORECASE)
_PLACEHOLDER_MARK = "【待补充"
_TASK_RE = re.compile(r"为了|旨在|目标是|任务是|需要完成")
_CAPABILITY_BUCKETS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("后端服务", ("Python", "Java", "FastAPI", "Django", "Spring Boot")),
    ("前端与交互", ("JavaScript", "TypeScript", "React", "Vue")),
    ("数据与存储", ("SQL", "MySQL", "PostgreSQL", "Redis")),
    ("工程与部署", ("Docker", "Kubernetes", "Linux", "Git", "AWS", "Azure")),
    ("模型与智能体", ("LLM", "RAG", "Agent", "LangChain", "LangGraph", "PyTorch", "TensorFlow", "机器学习", "深度学习")),
    ("产品与协作", ("产品设计", "数据分析", "项目管理")),
)
_CHECKLIST_STEPS: tuple[tuple[str, str, str], ...] = (
    ("direction", "方向匹配", "意向、身份和岗位是否对得上"),
    ("project_evidence", "项目证据", "经历块里有没有可引用原句"),
    ("quantified", "量化结果", "数字、规模和验收是否可核对"),
    ("risks", "风险/缺口", "缺模块、只清单、证据偏薄"),
    ("next_step", "下一步", "先改简历、准备面试，还是确认事实"),
)


def analyze_resume(profile: dict[str, Any], job: dict[str, Any] | None = None) -> dict[str, Any]:
    """Resume-first analysis. Job/JD is optional and only adds a match layer."""
    resume_text = str(profile.get("resume_text") or "").strip()
    if not resume_text:
        raise ValueError("请先在个人资料中上传并保存简历")

    skills = filter_blocked_skills(
        [*profile.get("skills", []), *extract_skills(resume_text)],
        profile.get("blocked_skills"),
    )
    lines = [re.sub(r"\s+", " ", line).strip() for line in resume_text.splitlines() if line.strip()]
    proven, unproven = _resume_strengths(skills, lines)

    found: list[str] = []
    missing: list[str] = []
    lowered = resume_text.casefold()
    for title, aliases in _RESUME_SECTIONS:
        if any(alias.casefold() in lowered for alias in aliases):
            found.append(title)
        else:
            missing.append(title)

    blocks = parse_resume_blocks(resume_text)
    project_items, talking_source = _talking_items(resume_text, blocks)
    talking_points = [
        _project_talking_point(
            item,
            source=str(item.get("source") or talking_source or "project"),
        )
        for item in project_items
    ]
    remember_line = _pick_remember_line(talking_points, proven)
    used_quotes: set[str] = set()
    proven = _dedupe_strength_quotes(proven, lines, used_quotes)
    _claim_quote(used_quotes, remember_line)
    strengths = (proven + unproven)[:6]

    short_resume = len(resume_text) < 400
    short_bullets = [line for line in lines if line.startswith(("-", "•", "·")) and len(line) < 18]
    gaps = _resume_gaps(
        lines=lines,
        missing=missing,
        projects=talking_points,
        unproven=unproven,
        short_resume=short_resume,
        short_bullets=short_bullets,
    )

    job_match = None
    job_text = ""
    if job:
        job_text = "\n".join(str(job.get(key) or "") for key in ("title", "description", "experience", "education")).strip()
    if len(job_text) >= 20:
        job_match = analyze_gap(job or {}, profile)

    remember_items, skip_core, skip_all = _impression_lists(
        remember_line=remember_line,
        unproven=unproven,
        projects=talking_points,
        missing=missing,
        job_match=job_match,
    )
    evidence = _distinct_job_evidence(job_match, proven, used_quotes)
    headline = _resume_headline(
        resume_text=resume_text,
        proven=proven,
        remember_line=remember_line,
        remember=remember_items[0] if remember_items else "",
        skip="；".join(skip_core),
        projects=talking_points,
        job_match=job_match,
    )
    next_actions = _resume_next_actions(
        unproven=unproven,
        projects=talking_points,
        missing_sections=missing,
        short_resume=short_resume,
        short_bullets=short_bullets,
        job_match=job_match,
        used_quotes=used_quotes,
        blocks=blocks,
    )
    scan = _resume_scan(
        profile=profile,
        resume_text=resume_text,
        lines=lines,
        skills=skills,
        remember_items=remember_items,
        skip_items=skip_all,
    )
    proven = [_with_block_ref(item, blocks, str(item.get("evidence") or "")) for item in proven]
    strengths = [_with_block_ref(item, blocks, str(item.get("evidence") or "")) for item in strengths]
    evidence = [_with_block_ref(item, blocks, str(item.get("text") or "")) for item in evidence]
    if headline.get("evidence"):
        headline["block_id"] = _block_id_for_quote(blocks, str(headline.get("evidence") or ""))
    metric_sample = next(
        (
            line for line in lines
            if _METRIC_RE.search(line) and not _is_skill_dump_line(line)
        ),
        "",
    )
    checklist = _resume_checklist(
        identity=str(scan.get("identity") or ""),
        target=str(scan.get("target") or ""),
        job_match=job_match,
        talking_source=talking_source,
        projects=talking_points,
        scan=scan,
        unproven=unproven,
        missing=missing,
        gaps=gaps,
        next_actions=next_actions,
        blocks=blocks,
        metric_sample=metric_sample,
    )
    return {
        "mode": "job_match" if job_match else "resume_only",
        "required_skills": (job_match or {}).get("required_skills", []),
        "matched_skills": (job_match or {}).get("matched_skills", skills),
        "missing_skills": (job_match or {}).get("missing_skills", []),
        "evidence": evidence[:5],
        "skill_coverage": None if job_match is None else job_match.get("skill_coverage"),
        "confidence": (job_match or {}).get("confidence", "limited"),
        "limitations": (
            job_match.get("limitations", []) if job_match
            else ["未提供具体岗位，以下是对已保存简历本身的分析"]
        ),
        "resume": {
            "character_count": len(resume_text),
            "skills": skills,
            "headline": headline,
            "scan": scan,
            "blocks": [
                {"id": block.id, "kind": block.kind, "title": block.title}
                for block in blocks
                if block.kind in {"project", "work", "education", "skill"}
            ],
            "checklist": checklist,
            "strengths": strengths,
            "evidence_matrix": _evidence_matrix(skills, proven, unproven, blocks),
            "structure": {"found": found, "missing": missing},
            "talking_source": talking_source,
            "projects": talking_points,
            "gaps": gaps[:6],
            "next_actions": next_actions,
        },
    }


def _impression_lists(
    *,
    remember_line: str,
    unproven: list[dict[str, Any]],
    projects: list[dict[str, Any]],
    missing: list[str],
    job_match: dict[str, Any] | None,
) -> tuple[list[str], list[str], list[str]]:
    remember_items: list[str] = []
    remember = _short_clause(remember_line) if remember_line else ""
    if remember:
        remember_items.append(remember)

    skip_core: list[str] = []
    dump_only = [item["label"] for item in unproven[:4]]
    if dump_only:
        skip_core.append(f"{'、'.join(dump_only)} 只出现在技能清单")
    weak_titles = [str(item.get("title") or "") for item in projects if item.get("weak")]
    if weak_titles:
        skip_core.append(f"「{weak_titles[0]}」还缺结果或职责边界")

    job_skip = ""
    if job_match:
        missing_skills = list(job_match.get("missing_skills") or [])
        if missing_skills:
            job_skip = f"岗位还要{'、'.join(missing_skills[:3])}，简历里没有原句"
            if not skip_core:
                skip_core.append(job_skip)

    skip_all = list(skip_core)
    if job_skip and job_skip not in skip_all:
        skip_all.append(job_skip)
    important_missing = [item for item in missing if item in {"教育经历", "工作经历", "项目经历"}]
    if important_missing:
        skip_all.append(f"结构上还看不到{'、'.join(important_missing)}")
    if not projects:
        skip_all.append("没有可展开的项目原句")
    elif all(item.get("source") == "work" for item in projects):
        skip_all.append("没有独立项目，只有工作条目")
    return remember_items, skip_core, skip_all


def _profile_identity(profile: dict[str, Any], resume_text: str) -> tuple[str, str]:
    suggested = suggest_profile_fields(resume_text)
    identity = str(profile.get("name") or "").strip() or str(suggested.get("name") or "").strip()
    roles = profile.get("target_roles") or suggested.get("target_roles") or []
    if isinstance(roles, str):
        roles = [roles]
    target = "、".join(str(item).strip() for item in roles if str(item).strip())[:80]
    return identity, target


def _resume_scan(
    *,
    profile: dict[str, Any],
    resume_text: str,
    lines: list[str],
    skills: list[str],
    remember_items: list[str],
    skip_items: list[str],
) -> dict[str, Any]:
    identity, target = _profile_identity(profile, resume_text)
    lowered = resume_text.casefold()
    modules: list[dict[str, Any]] = []
    for key, aliases in _SCAN_MODULES:
        present = any(alias.casefold() in lowered for alias in aliases)
        modules.append({"key": key, "present": present})
    metric_lines = [
        line for line in lines
        if _METRIC_RE.search(line) and not _is_skill_dump_line(line)
    ]
    modules.append({"key": "成果", "present": bool(metric_lines)})
    dump_lines = [line for line in lines if _is_skill_dump_line(line)]
    evidence_lines = [
        line for line in lines
        if _ACTION_RE.search(line) and not _is_skill_dump_line(line)
    ]
    if len(resume_text) < 400 and not metric_lines and len(evidence_lines) < 2:
        proof_label = "偏技能清单"
    elif metric_lines and evidence_lines:
        proof_label = "有可核对数字"
    elif evidence_lines:
        proof_label = "有经历、缺数字"
    else:
        proof_label = "证据偏薄"
    return {
        "identity": identity,
        "target": target,
        "headline_skills": skills[:5],
        "remember": remember_items,
        "skip": skip_items,
        "completeness": {
            "present": sum(1 for item in modules if item["present"]),
            "total": len(modules),
            "modules": modules,
        },
        "proof": {
            "label": proof_label,
            "character_count": len(resume_text),
            "metric_lines": len(metric_lines),
            "evidence_lines": len(evidence_lines),
            "skill_dump_lines": len(dump_lines),
        },
    }


def _bucket_for_skill(skill: str) -> str:
    for bucket, members in _CAPABILITY_BUCKETS:
        if skill in members:
            return bucket
    return "其他"


def _evidence_matrix(
    skills: list[str],
    proven: list[dict[str, Any]],
    unproven: list[dict[str, Any]],
    blocks: list[ResumeBlock] | None = None,
) -> list[dict[str, Any]]:
    proven_by_skill: dict[str, str] = {}
    for item in proven:
        evidence = str(item.get("evidence") or "").strip()
        if not evidence or _is_skill_dump_line(evidence):
            continue
        for skill in item.get("skills") or []:
            if skill not in proven_by_skill:
                proven_by_skill[str(skill)] = evidence
        label = str(item.get("label") or "")
        if label in skills and label not in proven_by_skill:
            proven_by_skill[label] = evidence

    grouped: dict[str, list[dict[str, Any]]] = {bucket: [] for bucket, _ in _CAPABILITY_BUCKETS}
    grouped["其他"] = []
    seen: set[str] = set()
    for skill in [*skills, *[item["label"] for item in unproven if item.get("label")]]:
        if skill in seen:
            continue
        seen.add(skill)
        evidence = proven_by_skill.get(skill, "")
        grouped[_bucket_for_skill(skill)].append({
            "skill": skill,
            "evidence": evidence[:240],
            "strength": "proven" if evidence else "mentioned",
            "block_id": _block_id_for_quote(blocks or [], evidence) if evidence else "",
        })

    matrix: list[dict[str, Any]] = []
    for bucket, _ in _CAPABILITY_BUCKETS:
        rows = grouped[bucket]
        if rows:
            matrix.append({"bucket": bucket, "rows": rows})
    if grouped["其他"]:
        matrix.append({"bucket": "其他", "rows": grouped["其他"]})
    return matrix


def _resume_headline(
    *,
    resume_text: str,
    proven: list[dict[str, Any]],
    remember_line: str,
    remember: str,
    skip: str,
    projects: list[dict[str, Any]],
    job_match: dict[str, Any] | None,
) -> dict[str, str]:
    evidence = remember_line.strip()[:240]
    remember = remember or (_short_clause(remember_line) if remember_line else "")

    if job_match:
        matched = list(job_match.get("matched_skills") or [])
        missing = list(job_match.get("missing_skills") or [])
        if matched and missing:
            verdict = (
                f"对照这份岗位，三十秒能记住{'、'.join(matched[:3])}；"
                f"还缺{'、'.join(missing[:3])}的可核对原句，投递前先补或拿掉。"
            )
        elif matched:
            verdict = f"对照这份岗位，简历里已有可引用的{'、'.join(matched[:3])}证据。"
        elif missing:
            verdict = f"对照这份岗位，任职要求在简历里还缺少可引用的原句，例如{'、'.join(missing[:3])}。"
        else:
            verdict = "对照了岗位，但没有识别出可对照的技能关键词。把任职要求写具体会更准。"
        if not evidence and job_match.get("evidence"):
            evidence = str(job_match["evidence"][0].get("text") or "").strip()[:240]
            remember = remember or _short_clause(evidence)
        if missing:
            skip = skip or f"岗位还要{'、'.join(missing[:3])}，简历里没有原句"
        return {"verdict": verdict, "evidence": evidence, "remember": remember, "skip": skip}

    proven_labels = [item["label"] for item in proven[:2]]
    if len(resume_text) < 400 and not projects:
        verdict = "这份简历目前更像技能清单。招聘方扫三十秒留不下可追问的项目，面试也很难展开。"
        skip = skip or "没有可展开的项目原句"
    elif remember and skip:
        verdict = f"招聘方会记住「{remember}」；{skip}，三十秒里容易被跳过。"
    elif remember and proven_labels:
        verdict = f"招聘方会记住「{remember}」，已经能用项目原句支撑{proven_labels[0]}。"
    elif remember:
        verdict = f"招聘方会记住「{remember}」。把职责边界和结果写清，面试会更好讲。"
    elif proven_labels:
        verdict = f"能看出你会{proven_labels[0]}，但缺少可展开的项目段落。"
        skip = skip or "没有可展开的项目原句"
    else:
        verdict = "还没有识别出可引用的技能原句。把项目里用过的工具写成完整句子会更有力。"
        skip = skip or "技能和项目都还缺少可引用原句"
    return {"verdict": verdict, "evidence": evidence, "remember": remember, "skip": skip}


def _action(
    title: str,
    detail: str,
    evidence: str = "",
    *,
    kind: str = "profile",
    intent: str = "edit_profile",
    patch: dict[str, str] | None = None,
    why: str = "",
    where: str = "",
    effect: str = "",
    block_id: str = "",
) -> dict[str, Any]:
    return {
        "title": title,
        "detail": detail,
        "evidence": evidence,
        "kind": kind,
        "intent": intent,
        "patch": patch,
        "why": why,
        "where": where,
        "effect": effect,
        "block_id": block_id,
    }


def _resume_next_actions(
    *,
    unproven: list[dict[str, Any]],
    projects: list[dict[str, Any]],
    missing_sections: list[str],
    short_resume: bool,
    short_bullets: list[str],
    job_match: dict[str, Any] | None,
    used_quotes: set[str] | None = None,
    blocks: list[ResumeBlock] | None = None,
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    used_quotes = used_quotes if used_quotes is not None else set()
    blocks = blocks or []
    skill_block_id = next((block.id for block in blocks if block.kind == "skill"), "")
    missing_skills = list((job_match or {}).get("missing_skills") or [])
    if missing_skills:
        actions.append(_action(
            f"补上岗位还缺的原句：{'、'.join(missing_skills[:3])}",
            "有做过就写成「在某项目里用 X 做了 Y，结果是 Z」；没做过不要编，投递时先从技能栏拿掉。",
            intent="confirm_knowledge",
            why="对照岗位时，这些要求在简历里没有可引用原句。",
            where="项目经历或技能栏",
            effect="投递时能对上任职要求，或先拿掉没做过的技能避免被追问。",
            block_id=skill_block_id,
        ))
    unproven_labels = [item["label"] for item in unproven[:3]]
    if unproven_labels:
        actions.append(_action(
            f"给「{'、'.join(unproven_labels)}」补一句项目用法，或先从技能栏拿掉",
            "现在只有技能清单。面试官追问时拿不出原句，不如写成「在某项目里用 X 做了 Y」。",
            intent="confirm_knowledge",
            why="这些技能只出现在清单里，面试追问时拿不出项目原句。",
            where="专业技能 / 项目经历",
            effect="要么能讲清用法，要么避免把没证据的技能当优势。",
            block_id=skill_block_id,
        ))
    weak_project = next((item for item in projects if item.get("weak")), None)
    if weak_project:
        holes = [str(hole) for hole in (weak_project.get("holes") or [])[:2]]
        rewrite = weak_project.get("rewrite") or {}
        detail = "；".join(holes) if holes else "补一个可核对的数字，或写清你负责哪一块。"
        if rewrite.get("suggested"):
            detail = f"{detail} 可先改成：{rewrite['suggested']}"
        evidence = str(rewrite.get("original") or weak_project.get("evidence") or "")[:240]
        if _quote_key(evidence) in used_quotes:
            evidence = str(rewrite.get("original") or "")[:240]
            if _quote_key(evidence) in used_quotes:
                evidence = ""
        weak_evidence = str(weak_project.get("evidence") or "")
        patch = None
        if rewrite.get("original") and rewrite.get("suggested"):
            patch = {
                "original": str(rewrite["original"]),
                "suggested": str(rewrite["suggested"]),
            }
        section = "工作经历" if weak_project.get("source") == "work" else "项目经历"
        where = f"{section} · {weak_project['title']}"
        weak_block_id = str(weak_project.get("block_id") or _block_id_for_quote(blocks, evidence or weak_evidence))
        if _PLACEHOLDER_MARK in weak_evidence:
            actions.append(_action(
                f"把「{weak_project['title']}」里的【待补充】换成可核对的事实",
                "没有数字就保留待补充，不要编造成果。改完后重新分析。",
                evidence,
                intent="confirm_knowledge",
                why="这段经历里的【待补充】还不是可核对的事实。",
                where=where,
                effect="面试讲结果时不再卡住，也不用编数字。",
                block_id=weak_block_id,
            ))
        elif patch:
            actions.append(_action(
                f"给「{weak_project['title']}」补结果或职责",
                detail,
                evidence,
                kind="rewrite",
                intent="customize_resume",
                patch=patch,
                why="这段经历还缺结果或职责边界，三十秒里站不住。",
                where=where,
                effect="面试能按 STAR 讲完；数字不知道就标待补充。",
                block_id=weak_block_id,
            ))
        else:
            actions.append(_action(
                f"给「{weak_project['title']}」补结果或职责",
                detail,
                evidence,
                intent="edit_profile",
                why="这段经历还缺结果或职责边界，三十秒里站不住。",
                where=where,
                effect="面试能按 STAR 讲完；数字不知道就标待补充。",
                block_id=weak_block_id,
            ))
        _claim_quote(used_quotes, evidence)
    important_missing = [item for item in missing_sections if item in {"教育经历", "工作经历", "项目经历"}]
    if important_missing:
        actions.append(_action(
            f"补上简历模块：{'、'.join(important_missing)}",
            "去个人资料把缺失模块写进去，分析才能引用原句，面试也才有段落可讲。",
            intent="edit_profile",
            why="招聘方扫结构时看不到这些模块，分析也引用不到原句。",
            where="简历结构",
            effect="补上后分析能引用原句，面试也有段落可讲。",
        ))
    if short_resume:
        actions.append(_action(
            "把经历写具体",
            "每条写你做了什么、做成了什么，而不是只报技能名。数字不知道就标「待补充」。",
            intent="edit_profile",
            why="篇幅偏短，经历和结果都写不具体。",
            where="全文",
            effect="每条都有动作和结果，更好被引用和追问。",
        ))
    if len(short_bullets) >= 3:
        first_bullet = short_bullets[0]
        evidence = first_bullet[:240]
        if _quote_key(evidence) in used_quotes:
            evidence = ""
        rewrite = (
            _suggest_rewrite(first_bullet)
            if _PLACEHOLDER_MARK not in first_bullet
            else None
        )
        patch = (
            {"original": rewrite["original"], "suggested": rewrite["suggested"]}
            if rewrite
            else None
        )
        actions.append(_action(
            "把过短的条目写成完整经历",
            "一句话条目很难被引用。补上动作、职责边界和结果（没有数字就写待补充）。",
            evidence,
            kind="rewrite" if patch else "profile",
            intent="customize_resume" if patch else "edit_profile",
            patch=patch,
            why="一句话条目很难被引用，也撑不起 STAR。",
            where="过短的经历条目",
            effect="补上动作、职责边界和结果后，可以直接当面试素材。",
            block_id=_block_id_for_quote(blocks, evidence),
        ))
    if not actions:
        first_project = next((item for item in projects if item.get("block_id")), None)
        actions.append(_action(
            "补充每段经历里你的职责边界和结果",
            "简历已经能引用。再写清你负责什么、做成了什么，面试会更稳。",
            intent="interview_prep",
            why="已有可引用经历，职责边界和结果还能更稳。",
            where="各段经历",
            effect="面试追问时更不容易被问住。",
            block_id=str((first_project or {}).get("block_id") or ""),
        ))
    return actions[:4]


def _resume_gaps(
    *,
    lines: list[str],
    missing: list[str],
    projects: list[dict[str, Any]],
    unproven: list[dict[str, Any]],
    short_resume: bool,
    short_bullets: list[str],
) -> list[str]:
    gaps: list[str] = []
    if short_resume:
        gaps.append("简历偏短，经历和结果写得不够具体，面试时很难展开。")
    if not any(_METRIC_RE.search(line) for line in lines):
        gaps.append("几乎没有可核对的数字结果。补耗时、准确率、覆盖人数等，没有就标待补充。")
    dump_only = [item["label"] for item in unproven[:3]]
    if dump_only:
        gaps.append(f"{'、'.join(dump_only)} 只出现在技能清单，面试追问时没有原句可讲。")
    if "项目经历" in missing and not projects:
        gaps.append("没有清楚的项目段落，面试官不容易抓住可深挖的经历。")
    hole_set = list(dict.fromkeys(
        hole for item in projects for hole in (item.get("holes") or [])
    ))
    if hole_set:
        gaps.append(hole_set[0])
    if len(short_bullets) >= 3:
        gaps.append("有多条经历只有一句话，缺少你具体做了什么、做成了什么。")
    if missing:
        gaps.append(f"结构上缺少：{'、'.join(missing)}。")
    if not gaps:
        gaps.append("简历已有可引用的经历。补充每段经历里你的职责边界和结果，会更稳。")
    return gaps


def _resume_strengths(skills: list[str], lines: list[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[str, dict[str, Any]] = {}
    unproven: list[dict[str, Any]] = []
    for skill in skills:
        line, score = _best_evidence_for_skill(skill, lines)
        if not line or score < 2 or _is_skill_dump_line(line):
            unproven.append({"label": skill, "evidence": ""})
            continue
        line = _display_line(line)
        key = _quote_key(line)
        if key in grouped:
            grouped[key]["skills"].append(skill)
        else:
            grouped[key] = {"skills": [skill], "evidence": line[:240]}
    proven = []
    for item in grouped.values():
        skill_names = list(item["skills"])
        proven.append({
            "label": _capability_label(item["evidence"], skill_names),
            "evidence": item["evidence"],
            "skills": skill_names,
        })
    return proven, unproven


def _best_evidence_for_skill(skill: str, lines: list[str]) -> tuple[str, int]:
    ranked: list[tuple[int, str]] = []
    for line in lines:
        if not _line_mentions_skill(line, skill):
            continue
        ranked.append((_evidence_score(line), line))
    if not ranked:
        return "", -1
    ranked.sort(key=lambda item: item[0], reverse=True)
    return ranked[0][1], ranked[0][0]


def _evidence_score(line: str) -> int:
    score = 0
    stripped = line.lstrip("-•· ").strip()
    if line.startswith(("-", "•", "·")):
        score += 4
    if _ACTION_RE.search(stripped):
        score += 3
    if _METRIC_RE.search(stripped):
        score += 5
    if _OWNERSHIP_RE.search(stripped):
        score += 2
    if _SCALE_RE.search(stripped):
        score += 2
    if len(stripped) >= 24:
        score += 1
    if len(stripped) >= 48:
        score += 1
    if _is_skill_dump_line(line):
        score -= 10
    return score


def _is_skill_dump_line(line: str) -> bool:
    stripped = line.strip().lstrip("-•· ").strip()
    headed = bool(_SKILL_HEADING_RE.match(stripped))
    rest = _SKILL_HEADING_RE.sub("", stripped)
    separators = rest.count("、") + rest.count(",") + rest.count("/") + rest.count("|")
    has_action = bool(_ACTION_RE.search(rest))
    has_metric = bool(_METRIC_RE.search(rest))
    if headed and not has_action:
        return True
    if separators >= 2 and not has_action and not has_metric:
        return True
    return False


def _line_mentions_skill(line: str, skill: str) -> bool:
    return _contains(line.lower(), skill.lower())


def _capability_label(evidence: str, skills: list[str]) -> str:
    match = re.search(r"(?:完成|实现|开发|负责|设计|搭建|优化|接入)\s*([^，。,；;]{4,24})", evidence)
    if match:
        phrase = match.group(1).strip("的了 ")
        if skills:
            return f"{phrase}（{'、'.join(skills[:3])}）"
        return phrase
    for bucket, members in _CAPABILITY_BUCKETS:
        hits = [skill for skill in skills if skill in members]
        if hits:
            extra = [skill for skill in skills if skill not in hits]
            labels = [bucket, *extra[:2]] if extra else [bucket]
            return " · ".join(labels) if extra else f"{bucket}（{'、'.join(hits[:3])}）"
    return "、".join(skills[:3]) if skills else "可引用经历"


def _pick_remember_line(projects: list[dict[str, Any]], proven: list[dict[str, Any]]) -> str:
    bullets: list[str] = []
    for item in projects:
        for line in str(item.get("evidence") or "").splitlines()[1:]:
            cleaned = line.strip()
            if cleaned and not _is_skill_dump_line(cleaned):
                bullets.append(cleaned)
    ranked = sorted(bullets, key=_evidence_score, reverse=True)
    for line in ranked:
        if _evidence_score(line) >= 4:
            return _display_line(line)[:240]
    for item in proven:
        evidence = str(item.get("evidence") or "").strip()
        if evidence and not _is_skill_dump_line(evidence):
            return _display_line(evidence)[:240]
    return _display_line(ranked[0])[:240] if ranked else ""


def _dedupe_strength_quotes(
    proven: list[dict[str, Any]],
    lines: list[str],
    used_quotes: set[str],
) -> list[dict[str, Any]]:
    unique: list[dict[str, Any]] = []
    for item in proven:
        evidence = str(item.get("evidence") or "").strip()
        if _quote_key(evidence) in used_quotes:
            alternate = ""
            for skill in item.get("skills") or []:
                candidate, score = _best_evidence_for_skill(str(skill), lines)
                if (
                    score >= 2
                    and _quote_key(_display_line(candidate)) not in used_quotes
                    and not _is_skill_dump_line(candidate)
                ):
                    alternate = _display_line(candidate)[:240]
                    break
            evidence = alternate
        item = {**item, "evidence": evidence}
        if evidence:
            _claim_quote(used_quotes, evidence)
            unique.append(item)
        elif item.get("label"):
            unique.append(item)
    return unique


def _distinct_job_evidence(
    job_match: dict[str, Any] | None,
    proven: list[dict[str, Any]],
    used_quotes: set[str],
) -> list[dict[str, Any]]:
    rows = list((job_match or {}).get("evidence") or [])
    if not rows:
        rows = [
            {"skills": list(item.get("skills") or [item["label"]]), "text": item["evidence"]}
            for item in proven
            if item.get("evidence")
        ]
    distinct: list[dict[str, Any]] = []
    seen = set(used_quotes)
    for item in rows:
        text = str(item.get("text") or "").strip()
        key = _quote_key(text)
        if not key or key in seen or _is_skill_dump_line(text):
            continue
        seen.add(key)
        distinct.append({
            **item,
            "text": text[:240],
            "block_id": item.get("block_id") or "",
        })
    if distinct:
        return distinct
    return [item for item in rows if str(item.get("text") or "").strip()][:5]


def _project_talking_point(item: dict[str, str], *, source: str = "project") -> dict[str, Any]:
    evidence = item["evidence"][:240]
    bullets = [
        re.sub(r"^[-•·]\s*", "", line).strip().rstrip("。.")
        for line in item["evidence"].splitlines()[1:]
        if line.strip()
    ]
    has_metric = bool(_METRIC_RE.search(item["evidence"]))
    has_ownership = bool(_OWNERSHIP_RE.search(item["evidence"]))
    has_collab = bool(_COLLAB_RE.search(item["evidence"]))
    has_scale = bool(_SCALE_RE.search(item["evidence"]))
    holes: list[str] = []
    if not has_metric:
        holes.append("缺可核对的结果（耗时、准确率、覆盖人数等；没有就标待补充）")
    if not has_ownership:
        holes.append("缺职责边界：你独立完成、主导，还是只参与其中一块")
    if not has_scale:
        holes.append("缺规模：用户量、QPS、数据量或团队人数")
    if not has_collab:
        holes.append("缺协作：和谁对接、你在链路里的位置")

    action_bits = [bullet for bullet in bullets if _ACTION_RE.search(bullet)]
    result_bits = [bullet for bullet in bullets if _METRIC_RE.search(bullet)]
    result = result_bits[0] if result_bits else ""
    action = next((bullet for bullet in action_bits if bullet != result), "") or (
        action_bits[0] if action_bits else (bullets[0] if bullets else "")
    )
    task = next(
        (
            bullet for bullet in bullets
            if _TASK_RE.search(bullet) and bullet not in {action, result}
        ),
        "",
    )
    lead = "面试按 STAR 讲这段工作经历" if source == "work" else "面试按 STAR 讲"
    if result:
        action_part = f"行动是「{action}」；" if action and action != result else ""
        how_to_talk = (
            f"{lead}：情境是「{item['title']}」；{action_part}"
            f"结果是「{result}」。"
            "准备被追问：你负责哪一块、结果怎么验收、如果重做会改什么。"
        )
    elif action:
        how_to_talk = (
            f"{lead}：情境是「{item['title']}」；行动是「{action}」。"
            "结果还缺数字，先讲清模块边界，数字标「待补充」，不要编。"
        )
    else:
        how_to_talk = (
            f"面试时不要只报「{item['title']}」。"
            "按背景、你做了什么、结果来讲；数字不知道就标待补充。"
        )

    rewrite = None
    weak_bullet = ""
    if bullets:
        def _weakness(bullet: str) -> tuple[bool, bool, int]:
            generic_duty = bool(re.match(r"负责", bullet)) and not _METRIC_RE.search(bullet)
            return (bool(_METRIC_RE.search(bullet)), not generic_duty, len(bullet))
        weak_bullet = min(bullets, key=_weakness)
    if (
        weak_bullet
        and _PLACEHOLDER_MARK not in weak_bullet
        and (len(weak_bullet) < 36 or not _METRIC_RE.search(weak_bullet))
    ):
        rewrite = _suggest_rewrite(weak_bullet)

    return {
        "title": item["title"],
        "evidence": evidence,
        "source": source,
        "block_id": str(item.get("block_id") or ""),
        "weak": not has_metric or len(item["evidence"]) < 80,
        "how_to_talk": how_to_talk,
        "holes": holes[:3],
        "rewrite": rewrite,
        "star": {
            "situation": item["title"],
            "task": task,
            "action": action,
            "result": result,
        },
    }


def _suggest_rewrite(bullet: str) -> dict[str, str]:
    text = re.sub(r"^[-•·]\s*", "", bullet).strip().rstrip("。.")
    extras: list[str] = []
    if not _OWNERSHIP_RE.search(text):
        extras.append("【待补充：你负责的模块边界】")
    if not _METRIC_RE.search(text):
        extras.append("【待补充：可核对的结果，如耗时/准确率/覆盖量】")
    suggested = text if not extras else f"{text}，{'，'.join(extras)}"
    return {
        "original": f"{text}。",
        "suggested": f"{suggested}。",
        "caveat": "数字未知就写待补充，不要编造。",
    }


def apply_resume_rewrite(resume_text: str, original: str, suggested: str) -> str:
    """Replace one resume sentence with the suggested rewrite, preserving bullets."""
    source = resume_text or ""
    original = (original or "").strip()
    suggested = (suggested or "").strip()
    if not original or not suggested:
        raise ValueError("没有可写入的改写")
    if _rewrite_needle(original) == _rewrite_needle(suggested):
        raise ValueError("改写与原句相同")

    if original in source:
        head, tail = source.split(original, 1)
        if original in tail:
            raise ValueError("原句在简历里出现了多次，请到个人资料里改这一段")
        return f"{head}{suggested}{tail}"

    needle = _rewrite_needle(original)
    if not needle:
        raise ValueError("没有可写入的改写")
    lines = source.splitlines(keepends=True)
    matches = [
        index for index, line in enumerate(lines)
        if _rewrite_needle(line.rstrip("\n")) == needle
    ]
    if len(matches) > 1:
        raise ValueError("原句在简历里出现了多次，请到个人资料里改这一段")
    if not matches:
        raise ValueError("简历里找不到这句原文，可能已经改过")
    index = matches[0]
    line = lines[index]
    newline = "\n" if line.endswith("\n") else ""
    body = line[:-1] if newline else line
    prefix_match = re.match(r"^(\s*(?:[-•·]\s*)?)", body)
    prefix = prefix_match.group(1) if prefix_match else ""
    lines[index] = f"{prefix}{suggested}{newline}"
    return "".join(lines)


def _rewrite_needle(text: str) -> str:
    return re.sub(r"\s+", " ", _display_line(text)).strip().rstrip("。.").casefold()


def _short_clause(text: str, limit: int = 42) -> str:
    cleaned = re.sub(r"^[-•·]\s*", "", text).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    parts = [part.strip() for part in re.split(r"[，。；;]", cleaned) if part.strip()]
    preferred = next((part for part in parts if _METRIC_RE.search(part)), "")
    if not preferred:
        preferred = next((part for part in parts if _ACTION_RE.search(part)), cleaned)
    return preferred[:limit].rstrip("，,。 ")


def _display_line(line: str) -> str:
    return re.sub(r"^[-•·]\s*", "", line.strip())


def _quote_key(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()[:160]


def _claim_quote(used: set[str], text: str) -> None:
    key = _quote_key(text)
    if key:
        used.add(key)


def _talking_items(
    resume_text: str,
    blocks: list[ResumeBlock],
) -> tuple[list[dict[str, str]], str]:
    projects = [block for block in blocks if block.kind == "project"]
    if projects:
        return [_block_as_item(block, "project") for block in projects[:6]], "project"
    works = [block for block in blocks if block.kind == "work"]
    if works:
        return [_block_as_item(block, "work") for block in works[:4]], "work"
    fallback = _resume_projects(resume_text)[:6]
    source = "project" if fallback else "none"
    if not fallback:
        fallback = _resume_section_blocks(resume_text, _WORK_HEADINGS)[:4]
        source = "work" if fallback else "none"
    for item in fallback:
        item["block_id"] = _block_id_for_quote(blocks, item.get("evidence") or item.get("title") or "")
        item["source"] = source
    return fallback, source


def _block_as_item(block: ResumeBlock, source: str) -> dict[str, str]:
    return {
        "title": block.title[:200],
        "evidence": block.evidence[:2_000],
        "block_id": block.id,
        "source": source,
    }


def _block_id_for_quote(blocks: list[ResumeBlock], text: str) -> str:
    needle = _quote_key(text)
    if not needle or len(needle) < 4:
        return ""
    for block in blocks:
        haystack = _quote_key(block.evidence)
        if needle in haystack:
            return block.id
        title = _quote_key(block.title)
        if len(title) >= 4 and title in needle:
            return block.id
    return ""


def _with_block_ref(item: dict[str, Any], blocks: list[ResumeBlock], text: str) -> dict[str, Any]:
    if item.get("block_id"):
        return item
    block_id = _block_id_for_quote(blocks, text)
    if not block_id:
        return item
    return {**item, "block_id": block_id}


def _checklist_item(
    key: str,
    status: str,
    summary: str,
    *,
    next_label: str,
    intent: str,
    detail: str,
    block_ids: list[str] | None = None,
    evidence: str = "",
) -> dict[str, Any]:
    title, question = next((item[1], item[2]) for item in _CHECKLIST_STEPS if item[0] == key)
    return {
        "key": key,
        "title": title,
        "question": question,
        "status": status,
        "summary": summary,
        "next_action": {
            "label": next_label,
            "intent": intent,
            "detail": detail,
        },
        "block_ids": [item for item in dict.fromkeys(block_ids or []) if item],
        "evidence": evidence[:240],
    }


def _resume_checklist(
    *,
    identity: str,
    target: str,
    job_match: dict[str, Any] | None,
    talking_source: str,
    projects: list[dict[str, Any]],
    scan: dict[str, Any],
    unproven: list[dict[str, Any]],
    missing: list[str],
    gaps: list[str],
    next_actions: list[dict[str, Any]],
    blocks: list[ResumeBlock],
    metric_sample: str = "",
) -> list[dict[str, Any]]:
    project_ids = [str(item.get("block_id") or "") for item in projects if item.get("block_id")]
    proof = scan.get("proof") or {}
    metric_lines = int(proof.get("metric_lines") or 0)
    evidence_lines = int(proof.get("evidence_lines") or 0)
    first_action = next_actions[0] if next_actions else None

    if job_match:
        matched = [str(item) for item in (job_match.get("matched_skills") or []) if item]
        missing_skills = [str(item) for item in (job_match.get("missing_skills") or []) if item]
        if matched and not missing_skills:
            direction = _checklist_item(
                "direction",
                "pass",
                f"对照岗位，简历原句能对上{'、'.join(matched[:3])}。",
                next_label="按这份岗位定制简历",
                intent="customize_resume",
                detail="命中来自简历原句，没有补写岗位没写的要求。",
                block_ids=project_ids,
            )
        elif matched and missing_skills:
            direction = _checklist_item(
                "direction",
                "warn",
                f"能对上{'、'.join(matched[:3])}；{'、'.join(missing_skills[:3])}还没有原句。",
                next_label="核对缺口，有做过再补原句",
                intent="confirm_knowledge",
                detail="没做过的技能不要编进简历，先从技能栏拿掉或标待确认。",
                block_ids=project_ids,
            )
        elif missing_skills:
            direction = _checklist_item(
                "direction",
                "gap",
                f"岗位要的{'、'.join(missing_skills[:3])}在简历里没有原句。",
                next_label="核对缺口，有做过再补原句",
                intent="confirm_knowledge",
                detail="没有原句就不能写成已具备。有做过再补，没做过不要编。",
            )
        else:
            direction = _checklist_item(
                "direction",
                "warn",
                "对照了岗位，但没有识别出可对照的技能关键词。",
                next_label="把任职要求写具体后再对照",
                intent="edit_profile",
                detail="岗位描述过短或缺少技能词时，方向只能作有限判断。",
            )
    elif target:
        who = f"{identity} · " if identity else ""
        direction = _checklist_item(
            "direction",
            "pass" if identity else "warn",
            f"{who}求职意向是{target}。这次没有对照具体岗位。",
            next_label="按这个意向定制简历",
            intent="customize_resume",
            detail="意向来自简历或个人资料，没有推断没写明的方向。",
        )
    else:
        direction = _checklist_item(
            "direction",
            "gap",
            "简历未写明求职意向，方向只能从经历反推，把握有限。",
            next_label="先写清求职意向",
            intent="edit_profile",
            detail="不编造目标岗位。写清意向后再分析，对照才会准。",
        )

    if talking_source == "project" and projects:
        cited = [item for item in projects if str(item.get("evidence") or "").strip()]
        project_step = _checklist_item(
            "project_evidence",
            "pass" if cited else "warn",
            f"核对了 {len(projects)} 个项目块" + ("，其中有可引用原句。" if cited else "，证据还偏薄。"),
            next_label="按项目块准备面试" if cited else "把项目块写成可引用原句",
            intent="interview_prep" if cited else "customize_resume",
            detail="只引用已切出的项目块，不补写没出现的经历。",
            block_ids=project_ids,
            evidence=str((cited or projects)[0].get("evidence") or ""),
        )
    elif talking_source == "work" and projects:
        project_step = _checklist_item(
            "project_evidence",
            "warn",
            "没有独立项目块，下面按工作经历核对。",
            next_label="把工作条目拆成可讲的项目",
            intent="customize_resume",
            detail="工作块可以先讲职责和结果；有独立项目再补项目块。",
            block_ids=project_ids,
            evidence=str(projects[0].get("evidence") or ""),
        )
    else:
        project_step = _checklist_item(
            "project_evidence",
            "gap",
            "没有可引用的项目或工作块。",
            next_label="去个人资料补项目或工作经历",
            intent="edit_profile",
            detail="没有经历块就不能证明项目能力，也不要编造项目。",
        )

    if metric_lines:
        sample = _short_clause(metric_sample) if metric_sample else ""
        quantified = _checklist_item(
            "quantified",
            "pass",
            (
                f"{metric_lines} 条经历带可核对数字"
                + (f"，例如「{sample}」。" if sample else "。")
            ),
            next_label="按这些数字准备面试追问",
            intent="interview_prep",
            detail="数字来自简历原句。不知道怎么验收就标待补充，不要编。",
            block_ids=project_ids,
            evidence=metric_sample,
        )
    elif evidence_lines:
        quantified = _checklist_item(
            "quantified",
            "warn",
            "有经历原句，但还没有可核对数字。",
            next_label="补数字或标待补充",
            intent="confirm_knowledge",
            detail="没有数字就保留待补充，不要编造成果。",
            block_ids=project_ids,
        )
    else:
        quantified = _checklist_item(
            "quantified",
            "gap",
            "还没有可核对的结果数字。",
            next_label="补数字或标待补充",
            intent="confirm_knowledge",
            detail="没有数字就标待补充。分析不会填写未出现的结果。",
        )

    unproven_labels = [str(item.get("label") or "") for item in unproven[:3] if item.get("label")]
    important_missing = [item for item in missing if item in {"教育经历", "工作经历", "项目经历"}]
    weak_projects = [item for item in projects if item.get("weak")]
    risk_bits = [
        *([f"{'、'.join(unproven_labels)} 只出现在技能清单"] if unproven_labels else []),
        *([f"结构上看不到{'、'.join(important_missing)}"] if important_missing else []),
        *([f"「{weak_projects[0]['title']}」还缺结果或职责"] if weak_projects else []),
    ]
    if not risk_bits and gaps:
        risk_bits.append(str(gaps[0]))
    if not risk_bits:
        risks = _checklist_item(
            "risks",
            "pass",
            "未见明显结构缺口或无证据技能。",
            next_label="用现有证据准备面试",
            intent="interview_prep",
            detail="没有把未见的能力写成已具备。",
            block_ids=project_ids,
        )
    else:
        risks = _checklist_item(
            "risks",
            "gap" if len(risk_bits) >= 2 else "warn",
            "；".join(risk_bits[:2]),
            next_label="去核对缺口，不要编事实",
            intent="confirm_knowledge",
            detail="技能清单和缺失模块都需要人审。没做过不要写成做过。",
            block_ids=[str(item.get("block_id") or "") for item in weak_projects],
        )

    if first_action:
        next_step = _checklist_item(
            "next_step",
            "warn",
            str(first_action.get("title") or "先处理清单上的第一项"),
            next_label=str(first_action.get("title") or "先处理这一项"),
            intent=str(first_action.get("intent") or "edit_profile"),
            detail=str(first_action.get("detail") or first_action.get("effect") or ""),
            block_ids=[str(first_action.get("block_id") or "")],
            evidence=str(first_action.get("evidence") or ""),
        )
    else:
        next_step = _checklist_item(
            "next_step",
            "pass",
            "简历已有可引用经历，可以按现有证据准备面试。",
            next_label="去准备面试问答",
            intent="interview_prep",
            detail="没有新的改写建议。不要补写未见的成果。",
            block_ids=project_ids,
        )

    return [direction, project_step, quantified, risks, next_step]


def _resume_section_blocks(resume_text: str, headings: set[str]) -> list[dict[str, str]]:
    heading_keys = {item.casefold() for item in headings}
    lines = [re.sub(r"\s+", " ", line).strip() for line in resume_text.splitlines() if line.strip()]
    blocks: list[dict[str, str]] = []
    in_section = False
    title = ""
    body: list[str] = []

    def flush() -> None:
        nonlocal title, body
        if not title:
            return
        evidence = "\n".join([title, *body]).strip()
        blocks.append({"title": title[:200], "evidence": evidence[:2_000]})
        title = ""
        body = []

    for line in lines:
        normalized = line.casefold().rstrip(":：")
        if normalized in heading_keys:
            flush()
            in_section = True
            continue
        if normalized in _SECTION_HEADING_KEYS:
            flush()
            in_section = False
            continue
        if not in_section:
            continue
        if line.startswith(("-", "•", "·")):
            if title:
                body.append(line)
            continue
        flush()
        title = line
    flush()
    return blocks


def _resume_projects(resume_text: str) -> list[dict[str, str]]:
    blocks = _resume_section_blocks(resume_text, _PROJECT_HEADINGS)
    if blocks:
        return blocks
    lines = [re.sub(r"\s+", " ", line).strip() for line in resume_text.splitlines() if line.strip()]
    fallback: list[dict[str, str]] = []
    for index, line in enumerate(lines):
        if "项目" not in line or len(line) < 6:
            continue
        following = [item for item in lines[index + 1:index + 4] if item.startswith(("-", "•", "·"))]
        fallback.append({"title": line[:200], "evidence": "\n".join([line, *following])[:2_000]})
        if len(fallback) >= 4:
            break
    return fallback


def analyze_gap(job: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    job_text = "\n".join(str(job.get(key) or "") for key in ("title", "description", "experience", "education"))
    resume_text = str(profile.get("resume_text") or "")
    profile_skills = filter_blocked_skills(
        [*profile.get("skills", []), *extract_skills(resume_text)],
        profile.get("blocked_skills"),
    )
    required = extract_skills(job_text)
    matched = [skill for skill in required if skill in set(profile_skills)]
    missing = [skill for skill in required if skill not in matched]
    evidence = []
    for line in resume_text.splitlines():
        hits = [skill for skill in matched if skill.lower() in line.lower()]
        if hits:
            evidence.append({"skills": hits, "text": line.strip()[:240]})
        if len(evidence) >= 5:
            break
    coverage = round(len(matched) / len(required) * 100) if required else None
    return {
        "required_skills": required,
        "matched_skills": matched,
        "missing_skills": missing,
        "evidence": evidence,
        "skill_coverage": coverage,
        "confidence": "high" if job.get("description") and required else "limited",
        "limitations": [] if job.get("description") else ["岗位描述不完整，差距结果仅供初筛"],
    }


def _contains(text: str, term: str) -> bool:
    if re.fullmatch(r"[a-z0-9.+#-]+", term):
        return re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text) is not None
    return term in text


def _labeled_value(lines: list[str], labels: tuple[str, ...]) -> str:
    label_pattern = "|".join(re.escape(label) for label in labels)
    pattern = re.compile(rf"^(?:{label_pattern})(?:\s*[：:]\s*|\s+)(.+)$", re.IGNORECASE)
    for line in lines:
        match = pattern.match(line)
        if match:
            return match.group(1).strip()[:100]
    return ""


def _looks_like_name(value: str) -> bool:
    if value in {"个人简历", "简历", "求职简历", "RESUME", "Resume"}:
        return False
    common_surnames = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元顾孟黄穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊惠甄曲封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白蒲台从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公"
    chinese_name = re.fullmatch(rf"[{common_surnames}][\u4e00-\u9fff·]{{1,3}}", value)
    english_name = re.fullmatch(r"[A-Za-z][A-Za-z.'-]+(?: [A-Za-z][A-Za-z.'-]+){0,2}", value)
    english_title_words = {"engineer", "manager", "developer", "designer", "resume", "curriculum", "vitae"}
    return bool(chinese_name or (english_name and not english_title_words.intersection(value.lower().split())))


def _split_suggestions(value: str) -> list[str]:
    if not value:
        return []
    values = re.split(r"[，,、/|；;]+", value)
    return list(dict.fromkeys(item.strip() for item in values if item.strip()))[:8]

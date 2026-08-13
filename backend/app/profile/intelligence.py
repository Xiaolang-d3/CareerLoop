from __future__ import annotations

import re
from typing import Any


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


def extract_skills(text: str) -> list[str]:
    lowered = text.lower()
    found: list[str] = []
    for canonical, aliases in SKILL_ALIASES.items():
        if any(_contains(lowered, alias.lower()) for alias in aliases):
            found.append(canonical)
    return found


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
        "skills": extract_skills(text),
    }


_RESUME_SECTIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("教育经历", ("教育经历", "教育背景", "education")),
    ("工作经历", ("工作经历", "工作经验", "实习经历", "experience")),
    ("项目经历", ("项目经历", "项目经验", "项目实践", "projects")),
    ("专业技能", ("专业技能", "技能", "skills")),
    ("自我评价", ("自我评价", "个人简介", "summary")),
)
_PROJECT_HEADINGS = {"项目经历", "项目经验", "项目实践", "projects"}
_METRIC_RE = re.compile(
    r"\d+(?:\.\d+)?\s*%|\d[\d,.]*\s*(?:万|亿|人|用户|小时)|降低|提升|增长|完成"
)


def analyze_resume(profile: dict[str, Any], job: dict[str, Any] | None = None) -> dict[str, Any]:
    """Resume-first analysis. Job/JD is optional and only adds a match layer."""
    resume_text = str(profile.get("resume_text") or "").strip()
    if not resume_text:
        raise ValueError("请先在个人资料中上传并保存简历")

    skills = list(dict.fromkeys([*profile.get("skills", []), *extract_skills(resume_text)]))
    lines = [re.sub(r"\s+", " ", line).strip() for line in resume_text.splitlines() if line.strip()]
    strengths = []
    for skill in skills:
        evidence = next((line for line in lines if skill.lower() in line.lower()), "")
        strengths.append({"label": skill, "evidence": evidence[:240]})

    found: list[str] = []
    missing: list[str] = []
    lowered = resume_text.casefold()
    for title, aliases in _RESUME_SECTIONS:
        if any(alias.casefold() in lowered for alias in aliases):
            found.append(title)
        else:
            missing.append(title)

    projects = _resume_projects(resume_text)
    talking_points = []
    for item in projects[:6]:
        has_metric = bool(_METRIC_RE.search(item["evidence"]))
        talking_points.append({
            "title": item["title"],
            "evidence": item["evidence"][:240],
            "weak": not has_metric or len(item["evidence"]) < 80,
            "how_to_talk": (
                "按背景、你做了什么、结果来讲，并补上可核对的数字。"
                if not has_metric
                else "用这段经历讲清你负责的部分、决策和结果，避免只报项目名。"
            ),
        })

    gaps: list[str] = []
    if len(resume_text) < 400:
        gaps.append("简历偏短，经历和结果写得不够具体，面试时很难展开。")
    if not any(re.search(r"\d", line) for line in lines):
        gaps.append("几乎没有可核对的数字结果，贡献不容易被量化。")
    if "项目经历" in missing and not projects:
        gaps.append("没有清楚的项目段落，面试官不容易抓住可深挖的经历。")
    if "专业技能" in missing and not skills:
        gaps.append("技能写得不集中，对照岗位时缺少可引用的关键词。")
    short_bullets = [line for line in lines if line.startswith(("-", "•", "·")) and len(line) < 18]
    if len(short_bullets) >= 3:
        gaps.append("有多条经历只有一句话，缺少你具体做了什么、做成了什么。")
    if missing:
        gaps.append(f"结构上缺少：{'、'.join(missing)}。")
    if not gaps:
        gaps.append("简历已有可引用的经历。补充每段经历里你的职责边界和结果，会更稳。")

    job_match = None
    job_text = ""
    if job:
        job_text = "\n".join(str(job.get(key) or "") for key in ("title", "description", "experience", "education")).strip()
    if len(job_text) >= 20:
        job_match = analyze_gap(job or {}, profile)

    evidence = [
        {"skills": [item["label"]], "text": item["evidence"]}
        for item in strengths if item["evidence"]
    ][:5]
    return {
        "mode": "job_match" if job_match else "resume_only",
        "required_skills": (job_match or {}).get("required_skills", []),
        "matched_skills": (job_match or {}).get("matched_skills", skills),
        "missing_skills": (job_match or {}).get("missing_skills", []),
        "evidence": (job_match or {}).get("evidence", evidence),
        "skill_coverage": None if job_match is None else job_match.get("skill_coverage"),
        "confidence": (job_match or {}).get("confidence", "limited"),
        "limitations": (
            job_match.get("limitations", []) if job_match
            else ["未提供具体岗位，以下是对已保存简历本身的分析"]
        ),
        "resume": {
            "character_count": len(resume_text),
            "skills": skills,
            "strengths": strengths[:8],
            "structure": {"found": found, "missing": missing},
            "projects": talking_points,
            "gaps": gaps[:6],
        },
    }


def _resume_projects(resume_text: str) -> list[dict[str, str]]:
    lines = [re.sub(r"\s+", " ", line).strip() for line in resume_text.splitlines() if line.strip()]
    blocks: list[dict[str, str]] = []
    in_projects = False
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
        if normalized in _PROJECT_HEADINGS:
            flush()
            in_projects = True
            continue
        if normalized in {alias.casefold() for _, aliases in _RESUME_SECTIONS for alias in aliases}:
            flush()
            in_projects = False
            continue
        if not in_projects:
            continue
        if line.startswith(("-", "•", "·")):
            if title:
                body.append(line)
            continue
        flush()
        title = line
    flush()
    if blocks:
        return blocks
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
    profile_skills = list(dict.fromkeys([*profile.get("skills", []), *extract_skills(resume_text)]))
    required = extract_skills(job_text)
    profile_lower = f"{resume_text}\n{' '.join(map(str, profile_skills))}".lower()
    matched = [skill for skill in required if _contains(profile_lower, skill.lower())]
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

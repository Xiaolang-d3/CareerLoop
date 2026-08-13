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

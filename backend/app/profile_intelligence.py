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


def extract_skills(text: str) -> list[str]:
    lowered = text.lower()
    found: list[str] = []
    for canonical, aliases in SKILL_ALIASES.items():
        if any(_contains(lowered, alias.lower()) for alias in aliases):
            found.append(canonical)
    return found


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

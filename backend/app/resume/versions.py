from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from ..db import connect, json_dump, row_to_dict
from ..jobs.evaluations import get_latest_completed_job_evaluation
from ..profile.candidate_core import get_candidate_context, verify_candidate_material
from ..profile.intelligence import extract_skills
from .export import build_docx, build_pdf
from .layout import compose_rendered_sections, split_resume_layout


ResumeDecision = Literal["pending", "accepted", "rejected"]
ResumeVersionStatus = Literal["draft", "final"]
ResumeExportFormat = Literal["docx", "pdf"]
ResumeTemplate = Literal["classic", "compact", "minimal"]
ResumeStyle = Literal["navy", "forest", "ink", "wine"]

_RESUME_TEMPLATES = {"classic", "compact", "minimal"}
_RESUME_STYLES: dict[str, dict[str, str | bool]] = {
    "navy": {
        "title": "17324D",
        "heading": "2D5B7D",
        "body": "283A31",
        "accent": "3E8E6B",
        "rule": "DCE5E0",
        "chip": "EEF3F8",
        "serif": False,
    },
    "forest": {
        "title": "1A4D3A",
        "heading": "2D7A5A",
        "body": "24352C",
        "accent": "1C6D4E",
        "rule": "D5E4DB",
        "chip": "E7F4EE",
        "serif": False,
    },
    "ink": {
        "title": "1A1F24",
        "heading": "3D484E",
        "body": "293136",
        "accent": "4D575D",
        "rule": "C8CDD0",
        "chip": "EEF0F1",
        "serif": True,
    },
    "wine": {
        "title": "5C2433",
        "heading": "8B3D52",
        "body": "3A2A2E",
        "accent": "A34E62",
        "rule": "E4D4D8",
        "chip": "F6EEF0",
        "serif": False,
    },
}


def _resume_style(style_id: str | None) -> dict[str, str | bool]:
    return _RESUME_STYLES.get(style_id or "navy", _RESUME_STYLES["navy"])


def _resume_layout(raw: Any) -> dict[str, Any]:
    data = raw
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {}
    if not isinstance(data, dict):
        data = {}
    try:
        spacing = int(data.get("spacing", 100))
    except (TypeError, ValueError):
        spacing = 100
    return {
        "spacing": max(70, min(130, spacing)),
        "one_page": bool(data.get("one_page")),
    }


def _layout_scale(layout: dict[str, Any] | None) -> float:
    settings = _resume_layout(layout)
    scale = settings["spacing"] / 100
    if settings["one_page"]:
        scale = min(scale, 0.78)
    return scale


def create_resume_version(
    job_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if job_id is None:
        return create_baseline_resume_version(db_path=db_path)

    with connect(db_path) as conn:
        job_row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if job_row is None:
            raise ValueError("岗位项目不存在")
        profile = _latest_profile(conn)
        version_number = conn.execute(
            "SELECT COUNT(*) AS count FROM resume_versions WHERE job_id = ?",
            (job_id,),
        ).fetchone()["count"] + 1

    evaluation = get_latest_completed_job_evaluation(job_id, db_path=db_path)
    if evaluation is None:
        raise ValueError("请先生成岗位决策与证据报告")
    if evaluation["status"] not in {"completed", "partial_failed"}:
        raise ValueError("岗位决策报告尚未完成")
    if evaluation.get("is_stale"):
        raise ValueError("岗位、候选人知识或职业策略已更新，请重新生成岗位评估")

    job = row_to_dict(job_row) or {}
    resume_context = get_candidate_context(
        "resume", profile_id=int(profile["id"]),
        strategy_id=evaluation.get("strategy_id"), db_path=db_path,
    )
    resume_text = "\n".join(item["statement"] for item in resume_context["confirmed_facts"])
    if not resume_text.strip():
        raise ValueError("当前隐私模式下没有可用简历文本")

    title_parts = [
        str(job.get("company_name") or "").strip(),
        str(job.get("job_title") or "").strip(),
    ]
    title = " · ".join(part for part in title_parts if part)
    title = f"{title or '岗位'}定制简历 V{version_number}"
    material_view = _evaluation_material_view(evaluation, resume_context)
    return _persist_resume_version(
        job_id=job_id,
        profile_id=int(profile["id"]),
        evaluation_id=int(evaluation["id"]),
        title=title,
        resume_text=resume_text,
        changes=_build_changes(job, material_view, resume_text),
        db_path=db_path,
    )


def create_baseline_resume_version(
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        profile = _latest_profile(conn)
        version_number = conn.execute(
            """
            SELECT COUNT(*) AS count FROM resume_versions
            WHERE job_id IS NULL
            """
        ).fetchone()["count"] + 1

    resume_text = _saved_resume_text(profile, db_path=db_path)
    if not resume_text:
        raise ValueError("请先在个人资料中上传并保存简历")

    name = str(profile.get("name") or "").strip()
    title = f"{name or '简历'} V{version_number}"
    return _persist_resume_version(
        job_id=None,
        profile_id=int(profile["id"]),
        evaluation_id=None,
        title=title,
        resume_text=resume_text,
        changes=_build_baseline_changes(profile, resume_text),
        db_path=db_path,
    )


def list_resume_versions(
    job_id: int | None = None,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        if job_id is None:
            rows = conn.execute(
                """
                SELECT * FROM resume_versions
                ORDER BY id DESC
                """
            ).fetchall()
        else:
            job = conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if job is None:
                raise ValueError("岗位项目不存在")
            rows = conn.execute(
                """
                SELECT * FROM resume_versions
                WHERE job_id = ?
                ORDER BY id DESC
                """,
                (job_id,),
            ).fetchall()
        return [_version_response(row, conn, include_changes=False) for row in rows]


def get_resume_version(
    version_id: int,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM resume_versions WHERE id = ?",
            (version_id,),
        ).fetchone()
        if row is None:
            return None
        return _version_response(row, conn, include_changes=True)


def update_resume_version(
    version_id: int,
    *,
    title: str | None = None,
    status: ResumeVersionStatus | None = None,
    template_id: ResumeTemplate | None = None,
    style_id: ResumeStyle | None = None,
    layout: dict[str, Any] | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    updates: list[str] = []
    values: list[Any] = []
    if title is not None:
        clean_title = title.strip()
        if not clean_title:
            raise ValueError("版本名称不能为空")
        updates.append("title = ?")
        values.append(clean_title[:200])
    if status is not None:
        if status == "final":
            current = get_resume_version(version_id, db_path)
            if current is None:
                return None
            gate = verify_candidate_material(
                str(current.get("rendered_content") or ""),
                extra_source=str(current.get("base_content") or ""),
                db_path=db_path,
            )
            if not gate["can_finalize"]:
                first = gate.get("issues", [{}])[0].get("message", "事实安全门未通过")
                raise ValueError(f"不能标记为可信定稿：{first}")
        updates.append("status = ?")
        values.append(status)
    if template_id is not None:
        if template_id not in _RESUME_TEMPLATES:
            raise ValueError("不支持的简历类型")
        updates.append("template_id = ?")
        values.append(template_id)
    if style_id is not None:
        if style_id not in _RESUME_STYLES:
            raise ValueError("不支持的简历模板")
        updates.append("style_id = ?")
        values.append(style_id)
    if layout is not None:
        current = get_resume_version(version_id, db_path) or {}
        merged = _resume_layout({ **current.get("layout", {}), **layout })
        updates.append("layout_json = ?")
        values.append(json_dump(merged))
    with connect(db_path) as conn:
        existing = conn.execute(
            "SELECT id FROM resume_versions WHERE id = ?",
            (version_id,),
        ).fetchone()
        if existing is None:
            return None
        if updates:
            conn.execute(
                f"""
                UPDATE resume_versions
                SET {", ".join(updates)}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (*values, version_id),
            )
    return get_resume_version(version_id, db_path)


def update_resume_change(
    version_id: int,
    change_id: int,
    *,
    decision: ResumeDecision | None = None,
    after_text: str | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        change = conn.execute(
            """
            SELECT id, after_text FROM resume_changes
            WHERE id = ? AND version_id = ?
            """,
            (change_id, version_id),
        ).fetchone()
        if change is None:
            raise ValueError("简历修改项不存在")

        updates: list[str] = []
        values: list[Any] = []
        if decision is not None:
            updates.append("decision = ?")
            values.append(decision)
        if after_text is not None:
            updates.extend(("after_text = ?", "user_edited = 1"))
            values.append(after_text.strip()[:100_000])
        if updates:
            conn.execute(
                f"""
                UPDATE resume_changes
                SET {", ".join(updates)}, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND version_id = ?
                """,
                (*values, change_id, version_id),
            )
            _refresh_rendered_content(conn, version_id)

    version = get_resume_version(version_id, db_path)
    if version is None:
        raise ValueError("定制简历版本不存在")
    return version


def delete_resume_version(
    version_id: int,
    db_path: str | Path | None = None,
) -> bool:
    with connect(db_path) as conn:
        cursor = conn.execute("DELETE FROM resume_versions WHERE id = ?", (version_id,))
    return cursor.rowcount > 0


def export_resume_version(
    version_id: int,
    export_format: ResumeExportFormat,
    db_path: str | Path | None = None,
) -> tuple[bytes, str, str]:
    version = get_resume_version(version_id, db_path)
    if version is None:
        raise ValueError("定制简历版本不存在")
    content = str(version.get("rendered_content") or "").strip()
    if not content:
        raise ValueError("当前版本没有可导出的简历内容")
    gate = verify_candidate_material(
        content,
        extra_source=str(version.get("base_content") or ""),
        db_path=db_path,
    )
    if not gate["can_finalize"]:
        first = gate.get("issues", [{}])[0].get("message", "事实安全门未通过")
        raise ValueError(f"{first}。当前版本只能预览，不能导出为可信定稿")
    template_id = version.get("template_id", "classic")
    style_id = version.get("style_id", "navy")
    palette = _resume_style(style_id)
    scale = _layout_scale(version.get("layout"))
    if export_format == "docx":
        payload = build_docx(
            version["title"],
            content,
            template_id,
            palette,
            scale,
        )
        media_type = (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
    elif export_format == "pdf":
        payload = build_pdf(
            version["title"],
            content,
            template_id,
            palette,
            scale,
            version.get("layout"),
        )
        media_type = "application/pdf"
    else:
        raise ValueError("仅支持导出 DOCX 或 PDF")
    filename = f"{_safe_filename(version['title'])}.{export_format}"
    return payload, filename, media_type


def _version_response(
    row,
    conn,
    *,
    include_changes: bool,
) -> dict[str, Any]:
    version = row_to_dict(row) or {}
    decision_rows = conn.execute(
        """
        SELECT decision, COUNT(*) AS count
        FROM resume_changes
        WHERE version_id = ?
        GROUP BY decision
        """,
        (version["id"],),
    ).fetchall()
    counts = {"pending": 0, "accepted": 0, "rejected": 0}
    counts.update({item["decision"]: item["count"] for item in decision_rows})
    version["change_counts"] = counts
    version["change_count"] = sum(counts.values())
    version["layout"] = _resume_layout(version.get("layout") or version.pop("layout_json", None))
    if include_changes:
        rows = conn.execute(
            """
            SELECT * FROM resume_changes
            WHERE version_id = ?
            ORDER BY sort_order, id
            """,
            (version["id"],),
        ).fetchall()
        version["changes"] = [row_to_dict(item) for item in rows]
    else:
        version.pop("base_content", None)
        version.pop("rendered_content", None)
    return version


def _latest_profile(conn) -> dict[str, Any]:
    profile_row = conn.execute(
        "SELECT * FROM profiles ORDER BY updated_at DESC, id DESC LIMIT 1"
    ).fetchone()
    profile = row_to_dict(profile_row)
    if profile is None:
        raise ValueError("请先保存人物画像和简历")
    return profile


def _saved_resume_text(
    profile: dict[str, Any],
    *,
    db_path: str | Path | None = None,
) -> str:
    redacted = str(profile.get("resume_redacted_text") or "").strip()
    raw = str(profile.get("resume_text") or "").strip()
    if redacted or raw:
        return redacted or raw
    try:
        context = get_candidate_context(
            "resume",
            profile_id=int(profile["id"]),
            db_path=db_path,
        )
    except ValueError:
        return ""
    return "\n".join(
        str(item.get("statement") or "").strip()
        for item in context.get("confirmed_facts") or []
        if str(item.get("statement") or "").strip()
    )


def _persist_resume_version(
    *,
    job_id: int | None,
    profile_id: int,
    evaluation_id: int | None,
    title: str,
    resume_text: str,
    changes: list[dict[str, Any]],
    db_path: str | Path | None,
) -> dict[str, Any]:
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO resume_versions (
                job_id, profile_id, evaluation_id, title, base_content
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (job_id, profile_id, evaluation_id, title[:200], resume_text),
        )
        version_id = cursor.lastrowid
        for index, change in enumerate(changes, start=1):
            conn.execute(
                """
                INSERT INTO resume_changes (
                    version_id, change_type, section_key, before_text, after_text,
                    rationale, evidence_json, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    version_id,
                    change["change_type"],
                    change["section_key"],
                    change["before_text"],
                    change["after_text"],
                    change["rationale"],
                    json_dump(change["evidence"]),
                    index,
                ),
            )
        _refresh_rendered_content(conn, version_id)

    version = get_resume_version(version_id, db_path)
    if version is None:
        raise RuntimeError("定制简历版本创建后无法读取")
    return version


def _build_baseline_changes(
    profile: dict[str, Any],
    resume_text: str,
) -> list[dict[str, Any]]:
    name = str(profile.get("name") or "").strip()
    title_text = f"# {name}" if name else "# 简历"
    evidence = [
        {
            "source": "resume",
            "requirement_id": "",
            "requirement": "已保存简历",
            "excerpt": resume_text[:280],
        }
    ]
    return [
        {
            "change_type": "target",
            "section_key": "target",
            "before_text": "",
            "after_text": title_text,
            "rationale": "使用已保存资料中的姓名作为标题，未对照具体岗位",
            "evidence": evidence,
        },
        {
            "change_type": "reorder",
            "section_key": "body",
            "before_text": resume_text,
            "after_text": resume_text,
            "rationale": "按已保存简历原文排版，未新增未经证实的经历或能力",
            "evidence": evidence,
        },
    ]


def _evaluation_material_view(
    evaluation: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    facts = {int(item["id"]): item for item in context.get("confirmed_facts", [])}
    requirements = []
    for item in evaluation.get("effective_requirements", []):
        fact_ids = [int(value) for value in item.get("effective_fact_ids") or []]
        evidence = []
        for fact_id in fact_ids:
            fact = facts.get(fact_id)
            if not fact:
                continue
            statement = str(fact.get("statement") or "")
            evidence.append({
                "excerpt": statement,
                "matched_skills": extract_skills(statement),
                "matched_terms": [],
            })
        requirements.append({
            "id": item["requirement_key"], "text": item["text"],
            "importance": item["importance"],
            "status": item.get("effective_match_status", item["match_status"]),
            "evidence": evidence,
        })
    return {"requirements": requirements, "feedback": {}}


def _build_changes(
    job: dict[str, Any],
    analysis: dict[str, Any],
    resume_text: str,
) -> list[dict[str, Any]]:
    evidence: list[dict[str, str]] = []
    matched_terms: list[str] = []
    matched_term_keys: set[str] = set()
    prioritized_excerpts: list[str] = []
    feedback = analysis.get("feedback") or {}

    for requirement in analysis.get("requirements", []):
        effective_status = (
            feedback.get(requirement["id"], {}).get("status")
            or requirement.get("status")
        )
        if effective_status == "no_evidence":
            continue
        for item in requirement.get("evidence", []):
            excerpt = str(item.get("excerpt") or "").strip()
            if not excerpt:
                continue
            if excerpt not in prioritized_excerpts:
                prioritized_excerpts.append(excerpt)
            evidence.append(
                {
                    "source": "resume",
                    "requirement_id": requirement["id"],
                    "requirement": requirement["text"],
                    "excerpt": excerpt,
                }
            )
            for term in [
                *item.get("matched_skills", []),
                *item.get("matched_terms", []),
            ]:
                clean_term = str(term).strip()
                term_key = clean_term.casefold()
                if clean_term and term_key not in matched_term_keys:
                    matched_terms.append(clean_term)
                    matched_term_keys.add(term_key)

    job_title = str(job.get("job_title") or "目标岗位").strip()
    company_name = str(job.get("company_name") or "").strip()
    target_text = f"# {job_title}"
    if company_name:
        target_text += f"\n目标公司：{company_name}"

    if matched_terms:
        summary_text = (
            "## 职业概述\n"
            f"简历中可验证的岗位相关能力包括：{'、'.join(matched_terms[:8])}。"
            "以下内容仅重组和突出原简历已有事实。"
        )
        skills_text = "## 核心能力\n" + "\n".join(
            f"- {term}" for term in matched_terms[:12]
        )
    else:
        summary_text = (
            "## 职业概述\n"
            "当前版本仅重排原简历内容，未新增未经证实的能力表述。"
        )
        skills_text = ""

    original_lines = [
        line.strip()
        for line in resume_text.replace("\r\n", "\n").replace("\r", "\n").splitlines()
        if line.strip()
    ]
    priority_lines: list[str] = []
    remaining_lines: list[str] = []
    for line in original_lines:
        if any(line == excerpt or line.startswith(excerpt) for excerpt in prioritized_excerpts):
            if line not in priority_lines:
                priority_lines.append(line)
        else:
            remaining_lines.append(line)
    body_sections: list[str] = []
    if priority_lines:
        body_sections.append(
            "## 岗位相关经历与项目\n"
            + "\n".join(f"- {line}" for line in priority_lines)
        )
    if remaining_lines:
        body_sections.append(
            "## 其他经历与信息\n"
            + "\n".join(f"- {line}" for line in remaining_lines)
        )
    reordered_body = "\n\n".join(body_sections) or resume_text
    base_evidence = evidence or [
        {
            "source": "resume",
            "requirement_id": "",
            "requirement": "当前脱敏简历",
            "excerpt": resume_text[:280],
        }
    ]

    changes = [
        {
            "change_type": "target",
            "section_key": "target",
            "before_text": "",
            "after_text": target_text,
            "rationale": "明确该版本对应的目标岗位和公司",
            "evidence": [
                {
                    "source": "job",
                    "requirement_id": "",
                    "requirement": "岗位项目",
                    "excerpt": " · ".join(
                        item for item in (company_name, job_title) if item
                    ),
                }
            ],
        },
        {
            "change_type": "summary",
            "section_key": "summary",
            "before_text": "",
            "after_text": summary_text,
            "rationale": "只使用简历中已经出现且被岗位要求命中的能力生成概述",
            "evidence": base_evidence[:8],
        },
    ]
    if skills_text:
        changes.append(
            {
                "change_type": "skills",
                "section_key": "skills",
                "before_text": "",
                "after_text": skills_text,
                "rationale": "优先展示当前岗位能够从简历直接验证的能力关键词",
                "evidence": base_evidence[:12],
            }
        )
    changes.append(
        {
            "change_type": "reorder",
            "section_key": "body",
            "before_text": resume_text,
            "after_text": reordered_body,
            "rationale": "把与岗位要求直接相关的原始经历前置，其余内容保持原文",
            "evidence": base_evidence,
        }
    )
    return changes


def _refresh_rendered_content(conn, version_id: int) -> None:
    rows = conn.execute(
        """
        SELECT before_text, after_text, decision
        FROM resume_changes
        WHERE version_id = ?
        ORDER BY sort_order, id
        """,
        (version_id,),
    ).fetchall()
    sections = []
    for row in rows:
        content = row["before_text"] if row["decision"] == "rejected" else row["after_text"]
        if content.strip():
            sections.append(content.strip())
    conn.execute(
        """
        UPDATE resume_versions
        SET rendered_content = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (compose_rendered_sections(sections), version_id),
    )


def _safe_filename(value: str) -> str:
    clean = "".join(
        character
        for character in value.strip()
        if character not in '<>:"/\\|?*\0'
    )
    return (clean or "定制简历")[:100]

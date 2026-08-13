from __future__ import annotations

import asyncio
import json
import re
from hashlib import sha256
from pathlib import Path
from typing import Any, Literal

from ..profile.candidate_core import get_candidate_context
from ..config import get_settings
from ..db import connect, json_dump, row_to_dict, rows_to_dicts
from ..profile.intelligence import extract_skills
from ..research.web import AgentSearchClient, WebResearchError, build_evidence_bundle


EvaluationMode = Literal["full", "deep"]

SECTION_TITLES = {
    "a": "岗位概要",
    "b": "匹配、证据与缺口",
    "c": "职级与竞争策略",
    "d": "薪资与市场需求",
    "e": "简历定制计划",
    "f": "面试与 STAR+R",
    "g": "岗位真实性与用工风险",
}
DEFAULT_WEIGHTS = {
    "evidence_match": 30.0,
    "strategy_alignment": 20.0,
    "level_competition": 15.0,
    "compensation": 15.0,
    "work_culture": 10.0,
    "growth_company": 10.0,
}
DIMENSION_TITLES = {
    "evidence_match": "已确认证据匹配",
    "strategy_alignment": "职业策略适配",
    "level_competition": "职级和竞争位置",
    "compensation": "薪资条件",
    "work_culture": "工作方式与文化",
    "growth_company": "成长与公司前景",
}
DECISION_ORDER = {"apply": 0, "consider": 1, "research_first": 2, "skip": 3}
CONFIDENCE_ORDER = {"high": 0, "medium": 1, "low": 2}

_BONUS_MARKERS = ("加分", "优先", "更佳", "plus", "preferred")
_HARD_MARKERS = ("必须", "要求", "精通", "熟练", "本科", "硕士", "博士", "年以上", "至少", "required")
_RESPONSIBILITY_MARKERS = ("负责", "参与", "推动", "建设", "设计", "开发", "落地", "协作", "管理")
_NEGATION_PREFIXES = ("不收取", "无需缴纳", "不会收取", "不需要支付", "无须支付")


def validate_evaluation_weights(value: dict[str, Any] | None) -> dict[str, float]:
    if not value:
        return dict(DEFAULT_WEIGHTS)
    if set(value) != set(DEFAULT_WEIGHTS):
        raise ValueError("评分权重必须包含六个固定维度")
    weights: dict[str, float] = {}
    for key in DEFAULT_WEIGHTS:
        try:
            weight = float(value[key])
        except (TypeError, ValueError) as exc:
            raise ValueError("评分权重必须是数字") from exc
        if weight < 0 or weight > 50:
            raise ValueError("每个评分维度的权重必须在 0–50% 之间")
        weights[key] = round(weight, 2)
    if abs(sum(weights.values()) - 100) > 0.01:
        raise ValueError("六个评分维度的权重总和必须为 100%")
    return weights


def create_job_evaluation(
    job_id: int,
    *,
    strategy_id: int | None = None,
    include_public_research: bool = True,
    mode: EvaluationMode = "full",
    parent_evaluation_id: int | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    if mode not in {"full", "deep"}:
        raise ValueError("岗位评估模式不支持")
    with connect(db_path) as conn:
        job = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if job is None:
            raise ValueError("岗位项目不存在")
        resolved_strategy_id = strategy_id or job["career_strategy_id"]
        # Resolve the profile through the requested/job-bound strategy first.
        # Falling back to the most recently updated profile is only safe when
        # the job has no strategy binding (the normal single-user case).
        if resolved_strategy_id is not None:
            profile = conn.execute(
                """
                SELECT p.* FROM profiles p
                JOIN career_strategies s ON s.profile_id = p.id
                WHERE s.id = ?
                """,
                (resolved_strategy_id,),
            ).fetchone()
            if profile is None:
                raise ValueError("职业策略不存在")
            strategy = conn.execute(
                "SELECT * FROM career_strategies WHERE id = ? AND profile_id = ?",
                (resolved_strategy_id, profile["id"]),
            ).fetchone()
            if strategy is None:
                raise ValueError("职业策略不存在或不属于当前画像")
        else:
            profile = conn.execute(
                "SELECT * FROM profiles ORDER BY updated_at DESC, id DESC LIMIT 1"
            ).fetchone()
            if profile is None:
                raise ValueError("请先建立候选人画像")
            strategy = conn.execute(
                "SELECT * FROM career_strategies WHERE profile_id = ? ORDER BY is_active DESC, priority DESC, id LIMIT 1",
                (profile["id"],),
            ).fetchone()
            resolved_strategy_id = int(strategy["id"]) if strategy else None
        if parent_evaluation_id is not None:
            parent = conn.execute(
                "SELECT id, job_id FROM job_evaluations WHERE id = ?",
                (parent_evaluation_id,),
            ).fetchone()
            if parent is None or int(parent["job_id"]) != job_id:
                raise ValueError("父评估不存在或不属于当前岗位")

    description = str(job["description"] or "").strip()
    if len(description) < 20:
        raise ValueError("岗位 JD 至少需要 20 个字符才能生成完整评估")
    context = get_candidate_context(
        "match", profile_id=int(profile["id"]), strategy_id=resolved_strategy_id,
        db_path=db_path,
    )
    if not context.get("confirmed_facts"):
        raise ValueError("当前画像没有已确认事实，请先确认候选人知识")
    weights = validate_evaluation_weights((context.get("strategy") or {}).get("evaluation_weights"))
    job_fp = _job_fingerprint(dict(job))
    weights_fp = _fingerprint(weights)
    budget = 8 if mode == "deep" else 5
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO job_evaluations (
                job_id, profile_id, strategy_id, parent_evaluation_id, mode,
                include_public_research, research_budget, job_fingerprint,
                context_fingerprint, weights_fingerprint, knowledge_revision, model_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id, profile["id"], resolved_strategy_id, parent_evaluation_id,
                mode, int(include_public_research), budget, job_fp,
                context["fingerprint"], weights_fp,
                int(context["profile"]["knowledge_revision"]),
                "structured-rules-v5",
            ),
        )
        evaluation_id = int(cursor.lastrowid)
        for key, title in SECTION_TITLES.items():
            conn.execute(
                "INSERT INTO job_evaluation_sections (evaluation_id, section_key, title) VALUES (?, ?, ?)",
                (evaluation_id, key, title),
            )
    return get_job_evaluation(evaluation_id, db_path=db_path)


def execute_job_evaluation(
    evaluation_id: int,
    *,
    client: AgentSearchClient | None = None,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    base = _base_evaluation(evaluation_id, db_path)
    if base["status"] == "cancelled":
        return get_job_evaluation(evaluation_id, db_path=db_path)
    _set_evaluation_stage(evaluation_id, "extracting", db_path)
    try:
        with connect(db_path) as conn:
            job_row = conn.execute("SELECT * FROM jobs WHERE id = ?", (base["job_id"],)).fetchone()
            profile_row = conn.execute("SELECT * FROM profiles WHERE id = ?", (base["profile_id"],)).fetchone()
        job = row_to_dict(job_row) or {}
        profile = row_to_dict(profile_row) or {}
        context = get_candidate_context(
            "match", profile_id=int(base["profile_id"]), strategy_id=base.get("strategy_id"),
            db_path=db_path,
        )
        interview_context = get_candidate_context(
            "interview", profile_id=int(base["profile_id"]), strategy_id=base.get("strategy_id"),
            db_path=db_path,
        )
        strategy = context.get("strategy") or {}
        weights = validate_evaluation_weights(strategy.get("evaluation_weights"))
        requirements = _analyze_requirements(job, context)
        _save_requirements(evaluation_id, requirements, db_path)
        _save_job_source(evaluation_id, job, db_path)

        research_limitations: list[str] = []
        research_sources: list[dict[str, Any]] = []
        query_count = 0
        if base.get("include_public_research"):
            _set_evaluation_stage(evaluation_id, "researching", db_path)
            research_sources, research_limitations, query_count = asyncio.run(
                _research_job(
                    job,
                    budget=int(base.get("research_budget") or 5),
                    deep=base.get("mode") == "deep",
                    client=client,
                    db_path=db_path,
                )
            )
            _save_research_sources(evaluation_id, research_sources, db_path)
        else:
            research_limitations.append("本次评估未授权公开互联网研究，公司、薪资和时效信号可能不完整")

        if _is_cancelled(evaluation_id, db_path):
            return get_job_evaluation(evaluation_id, db_path=db_path)
        _set_evaluation_stage(evaluation_id, "scoring", db_path)
        risks = _detect_risks(job, strategy, context, research_sources, db_path)
        _save_risks(evaluation_id, risks, db_path)
        dimensions = _build_dimensions(
            job, strategy, context, requirements, research_sources, risks, weights
        )
        _save_dimensions(evaluation_id, dimensions, db_path)
        score_state = _score_state(dimensions, risks, _hard_stops(job, strategy, context))
        sections = _build_sections(
            job, profile, strategy, context, interview_context, requirements,
            dimensions, risks, research_sources, research_limitations, score_state,
        )
        for key in SECTION_TITLES:
            _save_section(evaluation_id, key, sections[key], db_path)
        limitations = list(dict.fromkeys([
            *research_limitations,
            "岗位评估只反映当前 JD、已确认候选人事实和评估时可获得的公开证据",
            "风险项是待核实观察，不是对公司或招聘方的事实指控",
        ]))
        partial = bool(base.get("include_public_research") and research_limitations)
        with connect(db_path) as conn:
            conn.execute(
                """
                UPDATE job_evaluations SET
                    status = ?, current_stage = 'completed', overall_score = ?, coverage = ?,
                    confidence = ?, final_decision = ?, risk_tier = ?, hard_stops_json = ?,
                    limitations_json = ?, summary_json = ?, research_query_count = ?,
                    completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status != 'cancelled'
                """,
                (
                    "partial_failed" if partial else "completed",
                    score_state["overall_score"], score_state["coverage"],
                    score_state["confidence"], score_state["final_decision"],
                    score_state["risk_tier"], json_dump(score_state["hard_stops"]),
                    json_dump(limitations), json_dump(score_state["summary"]),
                    query_count, evaluation_id,
                ),
            )
    except Exception as exc:
        with connect(db_path) as conn:
            conn.execute(
                """
                UPDATE job_evaluations SET status = 'failed', current_stage = 'failed',
                    error_message = ?, completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status != 'cancelled'
                """,
                (str(exc)[:2000], evaluation_id),
            )
    return get_job_evaluation(evaluation_id, db_path=db_path)


def get_job_evaluation(
    evaluation_id: int,
    *,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    result = _base_evaluation(evaluation_id, db_path)
    with connect(db_path) as conn:
        job_row = conn.execute(
            "SELECT job_title, company_name, location, salary_text, source_url FROM jobs WHERE id = ?",
            (result["job_id"],),
        ).fetchone()
        result["job"] = row_to_dict(job_row) or {}
        result["sections"] = rows_to_dicts(conn.execute(
            "SELECT * FROM job_evaluation_sections WHERE evaluation_id = ? ORDER BY section_key",
            (evaluation_id,),
        ).fetchall())
        result["dimensions"] = rows_to_dicts(conn.execute(
            "SELECT * FROM job_evaluation_dimensions WHERE evaluation_id = ? ORDER BY id",
            (evaluation_id,),
        ).fetchall())
        result["requirements"] = rows_to_dicts(conn.execute(
            "SELECT * FROM job_evaluation_requirements WHERE evaluation_id = ? ORDER BY id",
            (evaluation_id,),
        ).fetchall())
        result["risks"] = rows_to_dicts(conn.execute(
            "SELECT * FROM job_evaluation_risks WHERE evaluation_id = ? ORDER BY id",
            (evaluation_id,),
        ).fetchall())
        result["reviews"] = rows_to_dicts(conn.execute(
            "SELECT * FROM job_evaluation_reviews WHERE evaluation_id = ? ORDER BY id",
            (evaluation_id,),
        ).fetchall())
    result = _apply_reviews(result)
    result.update(_stale_state(result, db_path))
    return result


def list_job_evaluations(
    job_id: int,
    *,
    limit: int = 50,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    with connect(db_path) as conn:
        if conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone() is None:
            raise ValueError("岗位项目不存在")
        rows = conn.execute(
            "SELECT id FROM job_evaluations WHERE job_id = ? ORDER BY id DESC LIMIT ?",
            (job_id, max(1, min(limit, 100))),
        ).fetchall()
    return [get_job_evaluation(int(row["id"]), db_path=db_path) for row in rows]


def get_latest_completed_job_evaluation(
    job_id: int, *, db_path: str | Path | None = None
) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT id FROM job_evaluations
            WHERE job_id = ? AND status IN ('completed', 'partial_failed')
            ORDER BY id DESC LIMIT 1
            """,
            (job_id,),
        ).fetchone()
    return get_job_evaluation(int(row["id"]), db_path=db_path) if row else None


def cancel_job_evaluation(
    evaluation_id: int, *, db_path: str | Path | None = None
) -> dict[str, Any]:
    _base_evaluation(evaluation_id, db_path)
    with connect(db_path) as conn:
        conn.execute(
            """
            UPDATE job_evaluations SET status = 'cancelled', current_stage = 'cancelled',
                completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status IN ('queued', 'running')
            """,
            (evaluation_id,),
        )
    return get_job_evaluation(evaluation_id, db_path=db_path)


def retry_job_evaluation(
    evaluation_id: int, *, deep: bool = False, db_path: str | Path | None = None
) -> dict[str, Any]:
    previous = _base_evaluation(evaluation_id, db_path)
    return create_job_evaluation(
        int(previous["job_id"]), strategy_id=previous.get("strategy_id"),
        include_public_research=bool(previous.get("include_public_research")),
        mode="deep" if deep else previous.get("mode", "full"),
        parent_evaluation_id=evaluation_id, db_path=db_path,
    )


def interrupt_active_evaluations(*, db_path: str | Path | None = None) -> int:
    with connect(db_path) as conn:
        cursor = conn.execute(
            """
            UPDATE job_evaluations SET status = 'interrupted', current_stage = 'interrupted',
                error_message = CASE WHEN error_message = '' THEN '应用退出前评估未完成' ELSE error_message END,
                completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE status IN ('queued', 'running')
            """
        )
    return int(cursor.rowcount)


def review_job_evaluation(
    evaluation_id: int,
    *,
    target_type: str,
    target_key: str,
    action: str,
    override: dict[str, Any] | None = None,
    note: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    evaluation = get_job_evaluation(evaluation_id, db_path=db_path)
    if evaluation["status"] not in {"completed", "partial_failed"}:
        raise ValueError("只有已完成的岗位评估可以审核")
    if target_type not in {"requirement", "dimension", "risk", "compensation"}:
        raise ValueError("审核目标类型不支持")
    if action not in {"confirm", "edit", "reject", "resolve", "restore"}:
        raise ValueError("审核动作不支持")
    payload = dict(override or {})
    # Reviews are overlays on an immutable system snapshot.  Reject unknown
    # targets early so a typo cannot create a review that looks authoritative
    # but is never applied by the effective-result reducer.
    valid_targets = {
        "requirement": {str(item["requirement_key"]) for item in evaluation.get("requirements", [])},
        "dimension": {str(item["dimension_key"]) for item in evaluation.get("dimensions", [])},
        "risk": {str(item["risk_key"]) for item in evaluation.get("risks", [])},
        "compensation": {"compensation"},
    }[target_type]
    if target_key not in valid_targets:
        raise ValueError("审核目标不存在")
    if target_type == "requirement" and payload.get("match_status") in {"matched", "partial"}:
        fact_ids = [int(item) for item in payload.get("fact_ids") or []]
        if not fact_ids:
            raise ValueError("提高候选人匹配状态必须关联已确认事实")
        context = get_candidate_context(
            "match",
            profile_id=int(evaluation["profile_id"]),
            strategy_id=evaluation.get("strategy_id"),
            db_path=db_path,
        )
        confirmed_ids = {
            int(item["id"]) for item in context.get("confirmed_facts", [])
        }
        if not set(fact_ids).issubset(confirmed_ids):
            raise ValueError("匹配审核包含未确认、不属于当前画像或不存在的候选人事实")
    if target_type == "dimension" and "score" in payload:
        if target_key == "evidence_match":
            # Evidence matching is derived from requirement reviews and
            # confirmed candidate facts.  Allowing a free-form score here
            # would let a note promote unsupported/pending experience into
            # an official match without passing the fact safety gate.
            raise ValueError("证据匹配分必须由已确认事实和要求审核重算")
        score = float(payload["score"])
        if score < 0 or score > 100:
            raise ValueError("维度修正分必须在 0–100 之间")
        payload["score"] = score
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO job_evaluation_reviews (
                evaluation_id, target_type, target_key, action, override_json, note
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (evaluation_id, target_type, target_key[:100], action, json_dump(payload), note.strip()[:2000]),
        )
    return get_job_evaluation(evaluation_id, db_path=db_path)


def list_job_evaluation_sources(
    evaluation_id: int, *, db_path: str | Path | None = None
) -> list[dict[str, Any]]:
    _base_evaluation(evaluation_id, db_path)
    with connect(db_path) as conn:
        return rows_to_dicts(conn.execute(
            "SELECT * FROM job_evaluation_sources WHERE evaluation_id = ? ORDER BY source_tier, id",
            (evaluation_id,),
        ).fetchall())


def export_job_evaluation(
    evaluation_id: int, *, db_path: str | Path | None = None
) -> dict[str, Any]:
    evaluation = get_job_evaluation(evaluation_id, db_path=db_path)
    sources = list_job_evaluation_sources(evaluation_id, db_path=db_path)
    markdown = _evaluation_markdown(evaluation, sources)
    return {"json": {**evaluation, "sources": sources}, "markdown": markdown}


def create_job_comparison(
    evaluation_ids: list[int], *, db_path: str | Path | None = None
) -> dict[str, Any]:
    ids = list(dict.fromkeys(int(item) for item in evaluation_ids))
    if len(ids) < 2 or len(ids) > 10:
        raise ValueError("岗位比较需要选择 2–10 份评估")
    evaluations = [get_job_evaluation(item, db_path=db_path) for item in ids]
    if any(item["status"] not in {"completed", "partial_failed"} for item in evaluations):
        raise ValueError("只能比较已完成的岗位评估")
    strategy_ids = {item.get("strategy_id") for item in evaluations}
    weight_fps = {item.get("weights_fingerprint") for item in evaluations}
    if len(strategy_ids) != 1 or None in strategy_ids:
        raise ValueError("一次排名只能比较同一职业策略下的岗位")
    if len(weight_fps) != 1:
        raise ValueError("岗位评分权重版本不同，请重新评估后再比较")
    if any(item.get("is_stale") for item in evaluations):
        raise ValueError("比较中包含已过期评估，请先重新评估")
    ranked = sorted(
        evaluations,
        key=lambda item: (
            DECISION_ORDER.get(item["effective_final_decision"], 9),
            -(item.get("effective_overall_score") or -1),
            CONFIDENCE_ORDER.get(item.get("effective_confidence", "low"), 9),
        ),
    )
    result = {
        "strategy_id": next(iter(strategy_ids)),
        "entries": [
            {
                "evaluation_id": item["id"], "job_id": item["job_id"],
                "job_title": (item.get("job") or {}).get("job_title", ""),
                "company_name": (item.get("job") or {}).get("company_name", ""),
                "location": (item.get("job") or {}).get("location", ""),
                "rank": index, "score": item.get("effective_overall_score"),
                "coverage": item.get("effective_coverage"),
                "confidence": item.get("effective_confidence"),
                "decision": item.get("effective_final_decision"),
                "risk_tier": item.get("effective_risk_tier"),
                "dimensions": item.get("effective_dimensions", []),
            }
            for index, item in enumerate(ranked, start=1)
        ],
        "ranking_rule": "先按最终建议，再按匹配分和置信度排序；风险等级不修改匹配分",
    }
    with connect(db_path) as conn:
        cursor = conn.execute(
            "INSERT INTO job_comparisons (strategy_id, weights_fingerprint, result_json) VALUES (?, ?, ?)",
            (next(iter(strategy_ids)), next(iter(weight_fps)), json_dump(result)),
        )
        comparison_id = int(cursor.lastrowid)
        for entry in result["entries"]:
            conn.execute(
                "INSERT INTO job_comparison_entries (comparison_id, evaluation_id, rank) VALUES (?, ?, ?)",
                (comparison_id, entry["evaluation_id"], entry["rank"]),
            )
    return get_job_comparison(comparison_id, db_path=db_path)


def get_job_comparison(
    comparison_id: int, *, db_path: str | Path | None = None
) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM job_comparisons WHERE id = ?", (comparison_id,)).fetchone()
        if row is None:
            raise ValueError("岗位比较不存在")
    return row_to_dict(row) or {}


def _base_evaluation(evaluation_id: int, db_path: str | Path | None) -> dict[str, Any]:
    with connect(db_path) as conn:
        row = conn.execute("SELECT * FROM job_evaluations WHERE id = ?", (evaluation_id,)).fetchone()
    if row is None:
        raise ValueError("岗位评估不存在")
    return row_to_dict(row) or {}


def _set_evaluation_stage(evaluation_id: int, stage: str, db_path: str | Path | None) -> None:
    with connect(db_path) as conn:
        conn.execute(
            """
            UPDATE job_evaluations SET status = 'running', current_stage = ?,
                started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status != 'cancelled'
            """,
            (stage[:50], evaluation_id),
        )


def _is_cancelled(evaluation_id: int, db_path: str | Path | None) -> bool:
    with connect(db_path) as conn:
        row = conn.execute("SELECT status FROM job_evaluations WHERE id = ?", (evaluation_id,)).fetchone()
    return bool(row and row["status"] == "cancelled")


def _job_fingerprint(job: dict[str, Any]) -> str:
    return _fingerprint({key: job.get(key) for key in (
        "job_title", "company_name", "location", "salary_text", "source_url", "description"
    )})


def _fingerprint(value: Any) -> str:
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def _extract_requirements(description: str) -> list[dict[str, Any]]:
    fragments: list[str] = []
    for line in description.replace("\r", "\n").splitlines():
        clean = re.sub(r"^\s*(?:[-*•·]|\d+[.)、])\s*", "", line).strip()
        fragments.extend(item.strip(" ：:") for item in re.split(r"[。；;]", clean) if len(item.strip()) >= 4)
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for text in fragments:
        if text in seen or text in {"岗位职责", "职位描述", "任职要求", "岗位要求", "加分项"}:
            continue
        seen.add(text)
        lowered = text.lower()
        if any(marker in lowered for marker in _BONUS_MARKERS):
            kind, importance = "bonus", "bonus"
        elif any(marker in text for marker in _RESPONSIBILITY_MARKERS) and not any(marker in lowered for marker in _HARD_MARKERS):
            kind, importance = "responsibility", "core"
        else:
            kind = "requirement"
            importance = "hard" if any(marker in lowered for marker in _HARD_MARKERS) else "standard"
        result.append({"text": text[:500], "requirement_type": kind, "importance": importance})
        if len(result) >= 40:
            break
    return result


def _analyze_requirements(job: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    facts = context.get("confirmed_facts") or []
    result: list[dict[str, Any]] = []
    for index, requirement in enumerate(_extract_requirements(str(job.get("description") or "")), start=1):
        text = requirement["text"]
        required_skills = set(extract_skills(text))
        ascii_terms = {
            item.lower() for item in re.findall(r"[A-Za-z][A-Za-z0-9.+#-]{1,30}", text)
            if item.lower() not in {"and", "with", "the", "plus", "or"}
        }
        direct: list[int] = []
        adjacent: list[int] = []
        covered_skills: set[str] = set()
        covered_ascii: set[str] = set()
        for fact in facts:
            statement = str(fact.get("statement") or "")
            fact_skills = set(extract_skills(statement))
            skill_overlap = required_skills & fact_skills
            ascii_overlap = {term for term in ascii_terms if _contains_term(statement.lower(), term)}
            if skill_overlap or ascii_overlap:
                direct.append(int(fact["id"]))
                covered_skills.update(skill_overlap)
                covered_ascii.update(ascii_overlap)
            elif _keyword_overlap(text, statement) >= 2:
                adjacent.append(int(fact["id"]))
        fully_covered = (
            required_skills.issubset(covered_skills) if required_skills
            else ascii_terms.issubset(covered_ascii) if ascii_terms
            else True
        )
        if direct and fully_covered:
            status, confidence = "matched", min(1.0, 0.65 + len(direct) * 0.1)
            mitigation = "使用已确认事实中的具体背景、本人行动和结果直接举证"
        elif direct:
            status, confidence = "partial", min(0.8, 0.5 + len(direct) * 0.08)
            mitigation = "只覆盖了组合要求的一部分；分别列出已确认能力和仍缺少证据的能力，不得整体宣称已满足"
        elif adjacent:
            status, confidence = "partial", min(0.75, 0.4 + len(adjacent) * 0.08)
            mitigation = "只陈述相邻经验并明确能力边界；如有真实经历，先补充并确认候选人事实"
        else:
            status, confidence = "no_evidence", 0.8
            mitigation = "不要声称具备该能力；可通过真实项目补证、作品演示或向招聘方确认必要程度"
        result.append({
            "requirement_key": f"req-{index}", **requirement, "match_status": status,
            "fact_ids": direct, "adjacent_fact_ids": adjacent, "jd_excerpt": text,
            "mitigation": mitigation, "confidence": round(confidence, 2),
        })
    return result


def _contains_term(text: str, term: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text) is not None


def _keyword_overlap(left: str, right: str) -> int:
    stop = {"负责", "要求", "相关", "能力", "经验", "工作", "岗位", "进行", "以及", "具有"}
    left_tokens = set(re.findall(r"[\u4e00-\u9fff]{2,4}|[A-Za-z][A-Za-z0-9.+#-]+", left.lower())) - stop
    right_tokens = set(re.findall(r"[\u4e00-\u9fff]{2,4}|[A-Za-z][A-Za-z0-9.+#-]+", right.lower())) - stop
    return len(left_tokens & right_tokens)


def _save_requirements(evaluation_id: int, requirements: list[dict[str, Any]], db_path: str | Path | None) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM job_evaluation_requirements WHERE evaluation_id = ?", (evaluation_id,))
        for item in requirements:
            conn.execute(
                """
                INSERT INTO job_evaluation_requirements (
                    evaluation_id, requirement_key, text, requirement_type, importance,
                    match_status, fact_ids_json, adjacent_fact_ids_json, jd_excerpt,
                    mitigation, confidence
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    evaluation_id, item["requirement_key"], item["text"],
                    item["requirement_type"], item["importance"], item["match_status"],
                    json_dump(item["fact_ids"]), json_dump(item["adjacent_fact_ids"]),
                    item["jd_excerpt"], item["mitigation"], item["confidence"],
                ),
            )


def _save_job_source(evaluation_id: int, job: dict[str, Any], db_path: str | Path | None) -> None:
    excerpt = str(job.get("description") or "")[:5000]
    url = str(job.get("source_url") or "")
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO job_evaluation_sources (
                evaluation_id, source_key, title, url, source_type, source_tier,
                excerpt, content_hash
            ) VALUES (?, 'JD', ?, ?, 'job_posting', 1, ?, ?)
            """,
            (evaluation_id, f"{job.get('company_name', '')} · {job.get('job_title', '')}", url, excerpt, sha256(excerpt.encode()).hexdigest()),
        )


async def _research_job(
    job: dict[str, Any], *, budget: int, deep: bool, client: AgentSearchClient | None,
    db_path: str | Path | None = None,
) -> tuple[list[dict[str, Any]], list[str], int]:
    settings = get_settings()
    if client is None and not settings.web_research_enabled:
        return [], ["联网公司研究尚未启用，本次保留本地评估并将外部信息标记为未知"], 0
    search_client = client or AgentSearchClient(
        base_url=settings.agent_search_base_url, token=settings.agent_search_token,
        timeout_seconds=settings.web_research_timeout_seconds,
    )
    company = str(job.get("company_name") or "").strip()
    title = str(job.get("job_title") or "").strip()
    city = str(job.get("location") or "").strip()
    year = "2025 2026"
    queries: list[tuple[str, str]] = [
        ("identity", f'"{company}" 官网 公司介绍 产品 业务 招聘主体'),
        ("market_risk", f'"{company}" 最新消息 融资 经营 业务 {year}'),
        ("market_risk", f'"{company}" 裁员 欠薪 诉讼 经营异常 招聘风险 {year}'),
        ("market_risk", f'"{company}" "{title}" 薪资 {city} 招聘'),
        ("market_risk", f'"{company}" 招聘 劳务派遣 外包 培训贷 收费'),
    ]
    if deep:
        queries.extend([
            ("market_risk", f'"{company}" 技术团队 工程文化 技术栈 研发'),
            ("market_risk", f'"{company}" 竞争对手 市场 产品 差异化'),
            ("market_risk", f'"{company}" AI 战略 人工智能 产品 技术 {year}'),
        ])
    cached_identity = _load_job_research_cache(company, "identity", 30, db_path)
    cached_market = _load_job_research_cache(company, "market_risk", 7, db_path)
    sources: list[dict[str, Any]] = [*(cached_identity or []), *(cached_market or [])]
    warnings: list[str] = []
    seen: set[str] = {str(item.get("url") or "").split("#", 1)[0].rstrip("/") for item in sources}
    attempted = 0
    fresh_by_category: dict[str, list[dict[str, Any]]] = {"identity": [], "market_risk": []}
    pending_queries = [
        (category, query) for category, query in queries
        if not (category == "identity" and cached_identity) and not (category == "market_risk" and cached_market)
    ]
    for category, query in pending_queries[: max(0, min(budget, 8))]:
        attempted += 1
        try:
            batch = await search_client.search(query, 4)
        except WebResearchError as exc:
            warnings.append(f"公开搜索失败：{exc}")
            continue
        except Exception:
            warnings.append("公开搜索暂时不可用，相关信息保持未知")
            continue
        for source in batch:
            url = str(source.get("url") or "").split("#", 1)[0].rstrip("/")
            if not url or url in seen:
                continue
            seen.add(url)
            normalized_source = {**source, "query": query}
            sources.append(normalized_source)
            fresh_by_category[category].append(normalized_source)
            if len(sources) >= (12 if deep else 8):
                break
        if len(sources) >= (12 if deep else 8):
            break
    for category, fresh in fresh_by_category.items():
        if fresh:
            _save_job_research_cache(company, category, fresh, db_path)
    if not sources:
        warnings.append("本次公开研究没有取得可核验来源，不能据此判断公司不存在或岗位不真实")
        return [], list(dict.fromkeys(warnings)), attempted
    evidence = build_evidence_bundle(sources, official_website="")
    normalized = [{
        "source_key": item["id"], "title": item.get("title") or "", "url": item.get("url") or "",
        "query": item.get("query") or "", "source_type": item.get("source_type") or "third_party",
        "source_tier": int(item.get("source_tier") or 2), "excerpt": item.get("excerpt") or "",
        "published_at": item.get("published_at") or "",
    } for item in evidence[: (12 if deep else 8)]]
    return normalized, list(dict.fromkeys(warnings)), attempted


def _company_cache_key(value: str) -> str:
    text = re.sub(r"[（(][^）)]*[）)]", "", value.lower())
    text = re.sub(r"(有限责任公司|股份有限公司|有限公司|公司)$", "", text)
    return re.sub(r"[\W_]+", "", text, flags=re.UNICODE)


def _load_job_research_cache(
    company: str, category: str, max_age_days: int, db_path: str | Path | None,
) -> list[dict[str, Any]] | None:
    key = _company_cache_key(company)
    if not key:
        return None
    with connect(db_path) as conn:
        row = conn.execute(
            """
            SELECT sources_json FROM job_research_cache
            WHERE company_key = ? AND category = ?
              AND datetime(updated_at) >= datetime('now', ?)
            """,
            (key, category, f"-{max(1, max_age_days)} days"),
        ).fetchone()
    if row is None:
        return None
    try:
        sources = json.loads(row["sources_json"] or "[]")
    except json.JSONDecodeError:
        return None
    return [item for item in sources if isinstance(item, dict) and item.get("url")] or None


def _save_job_research_cache(
    company: str, category: str, sources: list[dict[str, Any]], db_path: str | Path | None,
) -> None:
    key = _company_cache_key(company)
    safe = [{
        "title": str(item.get("title") or "")[:300], "url": str(item.get("url") or "")[:2000],
        "domain": str(item.get("domain") or "")[:300], "snippet": str(item.get("snippet") or "")[:1200],
        "content": str(item.get("content") or "")[:5000], "published_at": str(item.get("published_at") or "")[:80],
        "score": item.get("score"), "query": str(item.get("query") or "")[:1000],
    } for item in sources if item.get("url")]
    if not key or not safe:
        return
    with connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO job_research_cache (company_key, category, company_name, sources_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(company_key, category) DO UPDATE SET
                company_name = excluded.company_name, sources_json = excluded.sources_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (key, category, company[:300], json_dump(safe)),
        )


def _save_research_sources(evaluation_id: int, sources: list[dict[str, Any]], db_path: str | Path | None) -> None:
    with connect(db_path) as conn:
        for index, item in enumerate(sources, start=1):
            excerpt = str(item.get("excerpt") or "")[:5000]
            key = f"S{index}"
            conn.execute(
                """
                INSERT OR REPLACE INTO job_evaluation_sources (
                    evaluation_id, source_key, title, url, query, source_type,
                    source_tier, excerpt, published_at, content_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    evaluation_id, key, str(item.get("title") or "")[:500],
                    str(item.get("url") or "")[:2000], str(item.get("query") or "")[:1000],
                    str(item.get("source_type") or "third_party")[:100], int(item.get("source_tier") or 2),
                    excerpt, str(item.get("published_at") or "")[:100], sha256(excerpt.encode()).hexdigest(),
                ),
            )


def _detect_risks(
    job: dict[str, Any], strategy: dict[str, Any], context: dict[str, Any],
    sources: list[dict[str, Any]], db_path: str | Path | None,
) -> list[dict[str, Any]]:
    text = "\n".join([
        str(job.get("description") or ""),
        *[str(item.get("excerpt") or "") for item in sources],
    ])
    risks: list[dict[str, Any]] = []

    def refs_for(pattern: str) -> list[str]:
        refs = ["JD"] if re.search(pattern, str(job.get("description") or ""), re.I) else []
        refs.extend(
            str(item.get("source_key") or "") for item in sources
            if re.search(pattern, str(item.get("excerpt") or ""), re.I)
        )
        return list(dict.fromkeys(item for item in refs if item)) or ["unknown_source"]

    def add(key: str, category: str, severity: str, observation: str, explanation: str, confidence: float = 0.8, evidence_refs: list[str] | None = None) -> None:
        risks.append({
            "risk_key": key, "category": category, "severity": severity,
            "confidence": confidence, "observation": observation,
            "explanation": explanation, "evidence_refs": evidence_refs or ["JD"],
        })

    direct_patterns = {
        "training_loan": (r"招转培|培训贷|贷款.{0,8}培训", "岗位文字出现培训贷款或招转培相关表述"),
        "recruitment_fee": (r"(?:缴纳|收取|支付).{0,8}(?:报名费|培训费|押金|保证金|入职费)", "岗位文字出现与求职或入职绑定的收费表述"),
        "credential_hold": (r"扣押.{0,8}(?:身份证|毕业证|证件)|提供.{0,6}担保", "岗位文字出现扣押证件或要求担保的表述"),
    }
    for key, (pattern, observation) in direct_patterns.items():
        match = re.search(pattern, text, re.I)
        if match and not any(prefix in text[max(0, match.start() - 8): match.end() + 4] for prefix in _NEGATION_PREFIXES):
            add(key, "recruitment_conduct", "critical", observation, "这是需要在继续流程前直接核实的招聘行为信号", 0.95, refs_for(pattern))
    employment_pattern = r"劳务派遣|劳务合同|人力外包|项目外包|派遣员工"
    if re.search(employment_pattern, text):
        add(
            "employment_classification", "employment_type", "warning",
            "岗位出现劳务、派遣或外包用工表述",
            "该表述本身不等于虚假招聘；应核实合同主体、实际用工单位、社保缴纳和薪酬责任",
            evidence_refs=refs_for(employment_pattern),
        )
    compensation_pattern = r"综合薪资|上不封顶|底薪.{0,8}(?:绩效|提成)|薪资.{0,8}面议"
    if re.search(compensation_pattern, text):
        add(
            "compensation_opacity", "compensation", "warning",
            "薪资可能包含浮动、提成或未拆分组成",
            "确认劳动合同固定工资、试用期工资、绩效条件和社保公积金基数",
            0.75, refs_for(compensation_pattern),
        )
    if re.search(r"我们的客户|代招|猎头顾问|招聘外包", text) and not re.search(r"用人单位|甲方公司|客户名称", text):
        add(
            "hiring_entity_unclear", "identity", "high",
            "招聘信息可能由中介或第三方发布，实际用人主体未明确",
            "核实劳动合同签署主体、实际工作公司和中介资质",
            0.8,
        )
    description = str(job.get("description") or "")
    if re.search(r"初级|应届|实习", description) and re.search(r"(?:8|9|10)年以上|专家级|战略负责人", description):
        add("seniority_contradiction", "jd_quality", "warning", "岗位职级和经验要求存在明显张力", "可能是模板复用或岗位边界尚未确定，建议向招聘方确认", 0.8)
    if not str(job.get("salary_text") or "").strip():
        add("salary_unstated", "compensation", "info", "岗位没有公开薪资", "薪资缺失不能单独作为虚假岗位依据", 0.95)

    # Work authorization is represented as a confirmed candidate fact rather
    # than inferred from a resume sentence.  Only raise a signal when the JD
    # explicitly mentions visa/work-permit sponsorship; domestic postings
    # remain unaffected by this global-compatibility check.
    authorization_pattern = r"签证|工作许可|工签|sponsorship|sponsor(?:ship)?|work authorization|visa"
    if re.search(authorization_pattern, text, re.I):
        authorization_facts = [
            fact for fact in context.get("confirmed_facts") or []
            if str(fact.get("category") or "").lower() in {
                "work_authorization", "work_authorisation", "visa", "immigration"
            }
            or any(key in (fact.get("value") or {}) for key in (
                "country", "country_code", "region", "requires_sponsorship", "visa_type",
            ))
        ]
        if not authorization_facts:
            add(
                "work_authorization_unknown", "work_authorization", "warning",
                "岗位涉及签证、工作许可或担保，但当前画像没有已确认的工作授权事实",
                "确认工作国家/地区、是否需要雇主担保、签证类型和雇主可提供的支持；未确认前不要对外承诺",
                0.65,
            )

    discovered_id = job.get("discovered_job_id")
    if discovered_id:
        with connect(db_path) as conn:
            found = conn.execute(
                "SELECT posting_status FROM discovered_jobs WHERE id = ?", (discovered_id,)
            ).fetchone()
            repeats = conn.execute(
                "SELECT COUNT(*) AS count FROM discovered_job_occurrences WHERE discovered_job_id = ? AND datetime(observed_at) >= datetime('now', '-90 days')",
                (discovered_id,),
            ).fetchone()["count"]
        if found and found["posting_status"] == "closed":
            add("posting_closed", "liveness", "critical", "已验证的岗位来源显示该职位下线", "下线岗位不应继续投入申请材料", 1.0)
        if int(repeats) >= 3:
            add("reposting_pattern", "freshness", "warning", f"90 天内记录到 {repeats} 次岗位出现", "重复出现可能有正常扩招原因，也可能表示岗位长期未关闭，需结合招聘方说明判断", 0.75)
    return risks


def _hard_stops(job: dict[str, Any], strategy: dict[str, Any], context: dict[str, Any]) -> list[str]:
    stops: list[str] = []
    company = str(job.get("company_name") or "").lower()
    haystack = " ".join(str(job.get(key) or "") for key in ("job_title", "company_name", "description")).lower()
    for value in strategy.get("blocked_companies") or []:
        if str(value).lower() in company:
            stops.append(f"不考虑公司：{value}")
    for value in strategy.get("blocked_keywords") or []:
        if str(value).lower() in haystack:
            stops.append(f"屏蔽关键词：{value}")
    for value in strategy.get("hard_constraints") or []:
        if str(value).lower() in haystack and any(marker in str(value) for marker in ("不要", "不接受", "禁止", "排除")):
            stops.append(f"硬性条件冲突：{value}")
    salary_range = _salary_range(str(job.get("salary_text") or ""))
    expected = (strategy.get("salary") or {}).get("min")
    if salary_range and isinstance(expected, (int, float)) and salary_range[1] * 1000 < float(expected):
        stops.append("岗位薪资上限低于职业策略最低要求")
    return list(dict.fromkeys(stops))


def _build_dimensions(
    job: dict[str, Any], strategy: dict[str, Any], context: dict[str, Any],
    requirements: list[dict[str, Any]], sources: list[dict[str, Any]],
    risks: list[dict[str, Any]], weights: dict[str, float],
) -> list[dict[str, Any]]:
    dimensions: list[dict[str, Any]] = []

    def add(key: str, score: float | None, rationale: list[str], evidence: list[str] | None = None) -> None:
        status = "evaluated" if score is not None else "unknown"
        confidence = "high" if score is not None and evidence else "medium" if score is not None else "low"
        dimensions.append({
            "dimension_key": key, "title": DIMENSION_TITLES[key], "score": round(score, 1) if score is not None else None,
            "weight": weights[key], "weighted_score": round(score * weights[key] / 100, 2) if score is not None else None,
            "status": status, "confidence": confidence, "rationale": rationale,
            "evidence_refs": evidence or [],
        })

    requirement_weights = {"hard": 3.0, "core": 2.0, "standard": 1.0, "bonus": 0.5}
    total = sum(requirement_weights[item["importance"]] for item in requirements)
    covered = sum(
        requirement_weights[item["importance"]] * (1 if item["match_status"] == "matched" else 0.5 if item["match_status"] == "partial" else 0)
        for item in requirements
    )
    add("evidence_match", covered / total * 100 if total else None, [
        f"{sum(item['match_status'] == 'matched' for item in requirements)} 项明确匹配",
        f"{sum(item['match_status'] == 'partial' for item in requirements)} 项相邻证据",
        f"{sum(item['match_status'] == 'no_evidence' for item in requirements)} 项缺少已确认证据",
    ], ["JD", *[f"fact:{fact_id}" for item in requirements for fact_id in item["fact_ids"]]])

    targets = [*strategy.get("target_roles", []), *strategy.get("title_expansions", [])]
    title = str(job.get("job_title") or "")
    if targets:
        exact = any(str(item).lower() in title.lower() or title.lower() in str(item).lower() for item in targets)
        overlap = max((_keyword_overlap(title, str(item)) for item in targets), default=0)
        score = 95 if exact else 70 if overlap >= 1 else 35
        add("strategy_alignment", score, [f"目标岗位：{'、'.join(map(str, targets[:6]))}", f"当前岗位：{title}"], ["JD", "strategy"])
    else:
        add("strategy_alignment", None, ["职业策略尚未配置目标岗位"])

    jd_level = _detect_seniority(title + "\n" + str(job.get("description") or ""))
    strategy_level = str(strategy.get("seniority") or "").strip()
    if jd_level and strategy_level:
        score = 90 if _normalize_level(jd_level) == _normalize_level(strategy_level) else 65
        add("level_competition", score, [f"岗位职级：{jd_level}", f"策略目标职级：{strategy_level}"], ["JD", "strategy"])
    elif jd_level:
        add("level_competition", 65, [f"识别岗位职级为{jd_level}，但策略未配置目标职级"], ["JD"])
    else:
        add("level_competition", None, ["JD 中没有足够信息判断职级"])

    offered = _salary_range(str(job.get("salary_text") or ""))
    salary = strategy.get("salary") or {}
    expected_min = salary.get("min")
    if offered and isinstance(expected_min, (int, float)):
        offered_min, offered_max = offered[0] * 1000, offered[1] * 1000
        score = 90 if offered_min >= expected_min else 70 if offered_max >= expected_min else 25
        add("compensation", score, [f"岗位公开薪资：{job.get('salary_text')}", f"策略最低薪资：{expected_min:g}"], ["JD", "strategy"])
    else:
        add("compensation", None, ["岗位或职业策略缺少可比较的薪资数字"])

    desired_modes = [str(item).lower() for item in strategy.get("work_modes") or []]
    location_targets = [str(item) for item in strategy.get("locations") or []]
    work_text = (str(job.get("location") or "") + " " + str(job.get("description") or "")).lower()
    detected_mode = "remote" if any(item in work_text for item in ("远程", "remote")) else "hybrid" if any(item in work_text for item in ("混合", "hybrid")) else "onsite" if any(item in work_text for item in ("坐班", "现场", "onsite", "on-site")) else ""
    if desired_modes or location_targets:
        mode_ok = not desired_modes or any(item in detected_mode or detected_mode in item for item in desired_modes if detected_mode)
        location = str(job.get("location") or "")
        location_ok = not location_targets or any(item in location or location in item for item in location_targets)
        add("work_culture", 90 if mode_ok and location_ok else 55 if mode_ok or location_ok else 25, [
            f"工作方式：{detected_mode or '未说明'}", f"地点：{location or '未说明'}"
        ], ["JD", "strategy"])
    else:
        add("work_culture", None, ["职业策略未配置地点或工作方式偏好"])

    source_text = " ".join(str(item.get("excerpt") or "") for item in sources)
    positives = len(re.findall(r"融资|增长|扩张|新产品|发布|获批|盈利", source_text))
    negatives = len(re.findall(r"裁员|欠薪|经营异常|停业|冻结|破产", source_text))
    if sources and (positives or negatives):
        add("growth_company", max(10, min(95, 60 + positives * 6 - negatives * 10)), [
            f"公开来源中记录到 {positives} 个积极词信号和 {negatives} 个风险词信号",
            "词项只用于初步结构化，不代表对公司经营状况的事实结论",
        ], [item.get("source_key", "") for item in sources])
    else:
        add("growth_company", None, ["缺少足够公开证据判断公司和岗位成长前景"])
    return dimensions


def _score_state(
    dimensions: list[dict[str, Any]], risks: list[dict[str, Any]], hard_stops: list[str]
) -> dict[str, Any]:
    evaluated = [item for item in dimensions if item["status"] == "evaluated" and item["score"] is not None]
    coverage = round(sum(item["weight"] for item in evaluated), 1)
    score = round(sum(item["score"] * item["weight"] for item in evaluated) / coverage, 1) if coverage else None
    confidence = "high" if coverage >= 85 else "medium" if coverage >= 60 else "low"
    critical = sum(item["severity"] == "critical" for item in risks)
    high = sum(item["severity"] == "high" for item in risks)
    warning = sum(item["severity"] == "warning" for item in risks)
    if critical or high >= 2:
        risk_tier = "suspicious"
    elif high or warning >= 2:
        risk_tier = "caution"
    elif not risks or all(item["severity"] == "info" for item in risks):
        risk_tier = "high_confidence"
    else:
        risk_tier = "unknown"
    if score is None:
        decision = "research_first"
    elif score >= 80:
        decision = "apply"
    elif score >= 65:
        decision = "consider"
    elif score >= 50:
        decision = "research_first"
    else:
        decision = "skip"
    if hard_stops or any(item["risk_key"] == "posting_closed" for item in risks):
        decision = "skip"
    elif risk_tier == "suspicious" or confidence == "low":
        decision = max((decision, "research_first"), key=lambda item: DECISION_ORDER[item])
    elif risk_tier == "caution":
        decision = max((decision, "consider"), key=lambda item: DECISION_ORDER[item])
    return {
        "overall_score": score, "coverage": coverage, "confidence": confidence,
        "final_decision": decision, "risk_tier": risk_tier, "hard_stops": hard_stops,
        "summary": {
            "evaluated_dimensions": len(evaluated), "unknown_dimensions": len(dimensions) - len(evaluated),
            "risk_count": len(risks), "critical_risk_count": critical,
        },
    }


def _build_sections(
    job: dict[str, Any], profile: dict[str, Any], strategy: dict[str, Any],
    context: dict[str, Any], interview_context: dict[str, Any], requirements: list[dict[str, Any]],
    dimensions: list[dict[str, Any]], risks: list[dict[str, Any]], sources: list[dict[str, Any]],
    research_limitations: list[str], score_state: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    jd = str(job.get("description") or "")
    job_family = next((item for item in [*strategy.get("target_roles", []), *strategy.get("title_expansions", [])] if _keyword_overlap(str(job.get("job_title") or ""), str(item)) or str(item).lower() in str(job.get("job_title") or "").lower()), str(job.get("job_title") or "待判断"))
    salary_components = [item for item in ("13薪", "14薪", "绩效", "提成", "奖金", "股票", "期权", "社保", "公积金") if item in (str(job.get("salary_text") or "") + jd)]
    matched = [item for item in requirements if item["match_status"] == "matched"]
    gaps = [item for item in requirements if item["match_status"] != "matched"]
    stories = interview_context.get("stories") or []
    story_map = []
    for requirement in requirements[:10]:
        related = [story for story in stories if set(requirement["fact_ids"]) & set(story.get("fact_ids") or [])]
        story_map.append({
            "requirement_key": requirement["requirement_key"], "requirement": requirement["text"],
            "story_ids": [item["id"] for item in related],
            "status": "ready" if related else "needs_story",
            "prompt": "补充真实背景、本人任务、行动、结果和反思" if not related else "使用已确认故事并按岗位要求调整重点",
        })
    evidence_refs = ["JD", *[item.get("source_key", "") for item in sources]]
    return {
        "a": _section({
            "job_family": job_family, "function": _detect_function(jd),
            "seniority": _detect_seniority(str(job.get("job_title") or "") + "\n" + jd) or "unknown",
            "location": job.get("location") or "unknown", "work_mode": _detect_work_mode(jd),
            "hiring_entity": job.get("company_name") or "unknown",
            "hard_stops": score_state["hard_stops"], "decision": score_state["final_decision"],
        }, "high", [], ["JD", "strategy"]),
        "b": _section({
            "matched_count": len(matched), "gap_count": len(gaps), "requirements": requirements,
            "rule": "只有已确认事实可以形成正式匹配；相邻证据只用于说明迁移能力",
        }, "high", [], ["JD", *[f"fact:{item}" for req in requirements for item in req["fact_ids"]]]),
        "c": _section({
            "job_level": _detect_seniority(jd) or "unknown", "target_level": strategy.get("seniority") or "unknown",
            "competition_position": _dimension_value(dimensions, "level_competition"),
            "strengths": [item["text"] for item in matched[:5]],
            "positioning": "突出已确认的高相关证据；对未覆盖要求明确边界，不通过夸大职级弥补",
            "downlevel_plan": ["确认薪资是否仍满足策略底线", "约定明确的复核周期和晋升标准"],
        }, "medium", [], ["JD", "strategy"]),
        "d": _section({
            "advertised_compensation": job.get("salary_text") or None,
            "components_detected": salary_components, "reliability": "medium" if job.get("salary_text") else "unknown",
            "market_sources": [item.get("source_key") for item in sources if any(word in (item.get("query") or "") for word in ("薪资", "招聘"))],
            "hr_questions": [
                "劳动合同中固定月薪是多少？", "公开薪资是否包含绩效、提成、补贴或加班费？",
                "试用期工资是否折扣、持续多久？", "社保和公积金按什么基数缴纳？",
                "奖金、13 薪或股权分别有哪些兑现条件？",
            ],
        }, "low" if not sources else "medium", research_limitations, evidence_refs),
        "e": _section({
            "top_changes": [{
                "section": "职业概述" if index == 0 else "经历与项目",
                "requirement_key": item["requirement_key"], "change": f"优先展示支持“{item['text']}”的已确认事实",
                "fact_ids": item["fact_ids"], "reason": "提高招聘方对核心要求的证据可见性",
            } for index, item in enumerate(matched[:5])],
            "missing_evidence": [{"requirement": item["text"], "mitigation": item["mitigation"]} for item in gaps[:5]],
            "action": "create_resume_version",
        }, "high", [], [f"fact:{item}" for req in matched for item in req["fact_ids"]]),
        "f": _section({
            "story_mapping": story_map, "recommended_case": stories[0]["id"] if stories else None,
            "reverse_questions": [
                "这个岗位入职前三个月最重要的成功标准是什么？",
                "当前团队希望新成员优先解决的业务或协作问题是什么？",
                "岗位实际汇报关系、团队配置和决策边界是什么？",
            ],
            "red_flag_prompts": [item["text"] for item in gaps[:4]], "action": "create_interview_kit",
        }, "high" if stories else "medium", ["没有已确认 STAR+R 故事时只生成追问，不编造故事"] if not stories else [], ["JD", *[f"story:{item['id']}" for item in stories]]),
        "g": _section({
            "risk_tier": score_state["risk_tier"], "signals": risks,
            "posting_liveness": "closed" if any(item["risk_key"] == "posting_closed" for item in risks) else "unverified" if not job.get("source_url") else "active_or_unverified",
            "ethical_rule": "展示观察、来源和替代解释，由用户决定是否继续；不得形成欺诈指控",
            "verification_questions": [item["explanation"] for item in risks if item["severity"] != "info"],
        }, "low" if research_limitations else "medium", research_limitations, evidence_refs),
    }


def _section(content: dict[str, Any], confidence: str, limitations: list[str], evidence_refs: list[str]) -> dict[str, Any]:
    return {"content": content, "confidence": confidence, "limitations": limitations, "evidence_refs": list(dict.fromkeys(item for item in evidence_refs if item))}


def _save_section(evaluation_id: int, key: str, section: dict[str, Any], db_path: str | Path | None) -> None:
    with connect(db_path) as conn:
        conn.execute(
            """
            UPDATE job_evaluation_sections SET status = ?, confidence = ?, content_json = ?,
                limitations_json = ?, evidence_refs_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE evaluation_id = ? AND section_key = ?
            """,
            (
                "partial" if section["limitations"] else "completed", section["confidence"],
                json_dump(section["content"]), json_dump(section["limitations"]),
                json_dump(section["evidence_refs"]), evaluation_id, key,
            ),
        )


def _save_dimensions(evaluation_id: int, dimensions: list[dict[str, Any]], db_path: str | Path | None) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM job_evaluation_dimensions WHERE evaluation_id = ?", (evaluation_id,))
        for item in dimensions:
            conn.execute(
                """
                INSERT INTO job_evaluation_dimensions (
                    evaluation_id, dimension_key, title, score, weight, weighted_score,
                    status, confidence, rationale_json, evidence_refs_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    evaluation_id, item["dimension_key"], item["title"], item["score"],
                    item["weight"], item["weighted_score"], item["status"], item["confidence"],
                    json_dump(item["rationale"]), json_dump(item["evidence_refs"]),
                ),
            )


def _save_risks(evaluation_id: int, risks: list[dict[str, Any]], db_path: str | Path | None) -> None:
    with connect(db_path) as conn:
        conn.execute("DELETE FROM job_evaluation_risks WHERE evaluation_id = ?", (evaluation_id,))
        for item in risks:
            conn.execute(
                """
                INSERT INTO job_evaluation_risks (
                    evaluation_id, risk_key, category, severity, confidence,
                    observation, explanation, evidence_refs_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    evaluation_id, item["risk_key"], item["category"], item["severity"],
                    item["confidence"], item["observation"], item["explanation"],
                    json_dump(item["evidence_refs"]),
                ),
            )


def _apply_reviews(evaluation: dict[str, Any]) -> dict[str, Any]:
    latest: dict[tuple[str, str], dict[str, Any]] = {}
    for review in evaluation.get("reviews", []):
        latest[(review["target_type"], review["target_key"])] = review
    requirements = [dict(item) for item in evaluation.get("requirements", [])]
    for item in requirements:
        review = latest.get(("requirement", item["requirement_key"]))
        if not review or review["action"] == "restore":
            continue
        if review["action"] == "reject":
            item["effective_match_status"] = "not_applicable"
        else:
            override = review.get("override") or {}
            item["effective_match_status"] = override.get("match_status", item["match_status"])
            if override.get("fact_ids"):
                item["effective_fact_ids"] = override["fact_ids"]
    for item in requirements:
        item.setdefault("effective_match_status", item["match_status"])
        item.setdefault("effective_fact_ids", item.get("fact_ids", []))

    dimensions = [dict(item) for item in evaluation.get("dimensions", [])]
    evidence_dimension = next((item for item in dimensions if item["dimension_key"] == "evidence_match"), None)
    if evidence_dimension and requirements:
        weights = {"hard": 3.0, "core": 2.0, "standard": 1.0, "bonus": 0.5}
        active = [item for item in requirements if item["effective_match_status"] != "not_applicable"]
        total = sum(weights[item["importance"]] for item in active)
        covered = sum(weights[item["importance"]] * (1 if item["effective_match_status"] == "matched" else 0.5 if item["effective_match_status"] == "partial" else 0) for item in active)
        evidence_dimension["effective_score"] = round(covered / total * 100, 1) if total else None
    for item in dimensions:
        review = latest.get(("dimension", item["dimension_key"]))
        if review and review["action"] != "restore":
            if review["action"] == "reject":
                item["effective_status"] = "unknown"
                item["effective_score"] = None
            else:
                override = review.get("override") or {}
                item["effective_score"] = override.get("score", item.get("score"))
                item["effective_status"] = override.get("status", item.get("status"))
        item.setdefault("effective_score", item.get("score"))
        item.setdefault("effective_status", item.get("status"))

    risks = [dict(item) for item in evaluation.get("risks", [])]
    effective_risks = []
    for item in risks:
        review = latest.get(("risk", item["risk_key"]))
        item["effective_status"] = "active"
        if review and review["action"] in {"reject", "resolve"}:
            item["effective_status"] = "resolved"
        elif review and review["action"] == "edit":
            override = review.get("override") or {}
            item["effective_severity"] = override.get("severity", item["severity"])
        item.setdefault("effective_severity", item["severity"])
        if item["effective_status"] == "active":
            effective_risks.append({**item, "severity": item["effective_severity"]})
    effective_dimensions = [{**item, "score": item["effective_score"], "status": item["effective_status"]} for item in dimensions]
    state = _score_state(effective_dimensions, effective_risks, evaluation.get("hard_stops") or [])
    return {
        **evaluation,
        "effective_requirements": requirements,
        "effective_dimensions": dimensions,
        "effective_risks": risks,
        "effective_overall_score": state["overall_score"],
        "effective_coverage": state["coverage"],
        "effective_confidence": state["confidence"],
        "effective_final_decision": state["final_decision"],
        "effective_risk_tier": state["risk_tier"],
    }


def _stale_state(evaluation: dict[str, Any], db_path: str | Path | None) -> dict[str, Any]:
    reasons: list[str] = []
    with connect(db_path) as conn:
        job = conn.execute("SELECT * FROM jobs WHERE id = ?", (evaluation["job_id"],)).fetchone()
        profile = conn.execute("SELECT knowledge_revision FROM profiles WHERE id = ?", (evaluation["profile_id"],)).fetchone()
        strategy = conn.execute("SELECT evaluation_weights_json FROM career_strategies WHERE id = ?", (evaluation.get("strategy_id"),)).fetchone() if evaluation.get("strategy_id") else None
    if job and _job_fingerprint(dict(job)) != evaluation.get("job_fingerprint"):
        reasons.append("岗位 JD 或岗位资料已更新")
    if profile and int(profile["knowledge_revision"]) != int(evaluation.get("knowledge_revision") or 0):
        reasons.append("候选人知识或职业策略已更新")
    if strategy:
        weights = validate_evaluation_weights(json.loads(strategy["evaluation_weights_json"] or "{}"))
        if _fingerprint(weights) != evaluation.get("weights_fingerprint"):
            reasons.append("评分权重已更新")
    return {"is_stale": bool(reasons), "stale_reasons": reasons}


def _evaluation_markdown(evaluation: dict[str, Any], sources: list[dict[str, Any]]) -> str:
    lines = [
        "# 岗位决策报告", "",
        f"- 匹配分：{evaluation.get('effective_overall_score') if evaluation.get('effective_overall_score') is not None else '未知'}",
        f"- 覆盖度：{evaluation.get('effective_coverage', 0)}%",
        f"- 置信度：{evaluation.get('effective_confidence')}",
        f"- 建议：{evaluation.get('effective_final_decision')}",
        f"- 风险：{evaluation.get('effective_risk_tier')}", "",
    ]
    for section in evaluation.get("sections", []):
        lines.extend([f"## {section['section_key'].upper()} · {section['title']}", "", "```json", json.dumps(section.get("content") or {}, ensure_ascii=False, indent=2), "```", ""])
    if sources:
        lines.append("## 来源")
        lines.append("")
        for source in sources:
            lines.append(f"- [{source.get('title') or source.get('source_key')}]({source.get('url') or '#'})")
    return "\n".join(lines).strip() + "\n"


def _salary_range(value: str) -> tuple[float, float] | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*[-~至—]\s*(\d+(?:\.\d+)?)\s*[kK]", value)
    if match:
        return float(match.group(1)), float(match.group(2))
    single = re.search(r"(\d+(?:\.\d+)?)\s*[kK]", value)
    return (float(single.group(1)), float(single.group(1))) if single else None


def _detect_seniority(text: str) -> str:
    for label, pattern in (
        ("executive", r"首席|总经理|副总裁|vp\b|chief"),
        ("director", r"总监|director|head of"),
        ("staff", r"专家|staff|principal|架构师"),
        ("senior", r"高级|资深|senior|负责人"),
        ("manager", r"经理|manager"),
        ("junior", r"初级|应届|实习|junior|intern"),
    ):
        if re.search(pattern, text, re.I):
            return label
    return ""


def _normalize_level(value: str) -> str:
    return _detect_seniority(value) or value.lower().strip()


def _detect_function(text: str) -> str:
    if re.search(r"管理|带领团队|团队负责人", text):
        return "manage"
    if re.search(r"咨询|客户|交付|解决方案", text):
        return "consult_or_deliver"
    if re.search(r"开发|设计|建设|实现", text):
        return "build"
    return "unknown"


def _detect_work_mode(text: str) -> str:
    if re.search(r"远程|remote", text, re.I):
        return "remote"
    if re.search(r"混合|hybrid", text, re.I):
        return "hybrid"
    if re.search(r"坐班|现场|onsite|on-site", text, re.I):
        return "onsite"
    return "unknown"


def _dimension_value(dimensions: list[dict[str, Any]], key: str) -> dict[str, Any]:
    item = next((item for item in dimensions if item["dimension_key"] == key), None)
    return {"score": item.get("score"), "status": item.get("status"), "rationale": item.get("rationale")} if item else {"score": None, "status": "unknown", "rationale": []}

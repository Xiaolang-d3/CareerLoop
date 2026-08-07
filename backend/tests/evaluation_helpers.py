from pathlib import Path

from app.candidate_core import create_strategy, propose_fact
from app.db import connect
from app.job_evaluations import create_job_evaluation, execute_job_evaluation


def seed_confirmed_facts_and_evaluation(
    job_id: int,
    db_path: str | Path,
    *,
    locations: list[str] | None = None,
    salary_min: int | None = None,
) -> dict:
    with connect(db_path) as conn:
        profile_id = int(conn.execute("SELECT id FROM profiles ORDER BY id DESC LIMIT 1").fetchone()["id"])
    strategy = create_strategy(
        profile_id=profile_id,
        name="测试主策略",
        target_roles=["AI 产品经理"],
        locations=locations or ["上海"],
        salary={"min": salary_min or 30_000},
        work_modes=["onsite"],
        is_active=True,
        db_path=db_path,
    )
    statements = [
        ("experience", "拥有5年产品经验，负责 Agent 产品规划和需求分析。"),
        ("project", "推动 RAG 产品落地，使用 Python 和 FastAPI 完成内部原型。"),
        ("credential", "已取得本科学历。"),
    ]
    for category, statement in statements:
        propose_fact(
            profile_id=profile_id, category=category, statement=statement,
            extraction_method="test_fixture", confidence=1.0, db_path=db_path,
        )
    with connect(db_path) as conn:
        conn.execute("UPDATE jobs SET career_strategy_id = ? WHERE id = ?", (strategy["id"], job_id))
    evaluation = create_job_evaluation(
        job_id, strategy_id=int(strategy["id"]), include_public_research=False,
        db_path=db_path,
    )
    return execute_job_evaluation(int(evaluation["id"]), db_path=db_path)

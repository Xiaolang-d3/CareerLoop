from pathlib import Path
from tempfile import TemporaryDirectory

from app.candidate_core import (
    create_or_update_profile,
    get_candidate_context,
    list_facts,
    merge_facts,
    propose_fact,
    review_fact,
    verify_candidate_material,
)
from app.db import init_db


def _profile(tmp_path: Path) -> Path:
    db_path = tmp_path / "memory.db"
    init_db(db_path)
    create_or_update_profile(name="测试候选人", db_path=db_path)
    return db_path


def test_proposed_memory_is_inbox_only_until_user_confirms() -> None:
    with TemporaryDirectory() as directory:
        db_path = _profile(Path(directory))
        proposal = propose_fact(
            category="achievement",
            statement="将响应时间降低 35%",
            source_id=8000,
            excerpt="性能优化后响应时间降低 35%",
            db_path=db_path,
        )

        assert proposal["status"] == "pending"
        assert proposal["evidence"][0]["excerpt"] == "性能优化后响应时间降低 35%"
        assert [item["id"] for item in list_facts(status="pending", db_path=db_path)] == [proposal["id"]]
        assert proposal["id"] not in [item["id"] for item in get_candidate_context("resume", db_path=db_path)["confirmed_facts"]]

        review_fact(proposal["id"], status="confirmed", db_path=db_path)
        context = get_candidate_context("resume", db_path=db_path)
        assert proposal["id"] in [item["id"] for item in context["confirmed_facts"]]
        assert verify_candidate_material("将响应时间降低 35%", db_path=db_path)["can_finalize"]


def test_retracted_memory_is_not_returned_by_default_or_to_the_agent() -> None:
    with TemporaryDirectory() as directory:
        db_path = _profile(Path(directory))
        proposal = propose_fact(category="skill", statement="具备 Python 经验", db_path=db_path)
        review_fact(proposal["id"], status="confirmed", db_path=db_path)
        review_fact(proposal["id"], status="retracted", db_path=db_path)

        assert not list_facts(db_path=db_path)
        assert [item["id"] for item in list_facts(status="retracted", db_path=db_path)] == [proposal["id"]]
        assert proposal["id"] not in [item["id"] for item in get_candidate_context("match", db_path=db_path)["confirmed_facts"]]


def test_memory_merge_keeps_target_and_hides_superseded_proposal() -> None:
    with TemporaryDirectory() as directory:
        db_path = _profile(Path(directory))
        target = propose_fact(category="skill", statement="具备 Python 服务开发经验", db_path=db_path)
        duplicate = propose_fact(category="skill", statement="Python 服务开发经验", db_path=db_path)

        merged = merge_facts(duplicate["id"], target["id"], db_path=db_path)

        assert merged["id"] == target["id"]
        assert [item["id"] for item in list_facts(status="pending", db_path=db_path)] == [target["id"]]

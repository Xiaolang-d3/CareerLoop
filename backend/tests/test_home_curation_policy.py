from __future__ import annotations

import json
from datetime import timedelta
from threading import Event

from app import workspace
from app.feeds import curation, digest, service
from test_home_curation import ARTICLE, EVIDENCE, NOW, home_workspace, pipeline


REAL_SPAWN = workspace.spawn_thread


def pick(ref=1, **patch):
    return {"ref": ref, "event_key": f"sdk-change-{ref}", "event_date": "2026-10-18", "title": "SDK 更新", "summary": "新增恢复接口", "why_it_matters": "可评估长任务恢复方案", "score": 85, "confidence": "high", "evidence": EVIDENCE, **patch}


def test_filtering_bounds_and_source_links_are_not_model_owned(home_workspace, pipeline):
    candidates, _ = curation._candidates([{**ARTICLE, "url": f"https://openai.com/index/{index}"} for index in range(8)], NOW)
    data = [pick(index + 1, score=75 + index, url="https://attacker.test/fake") for index in range(8)]
    data += [pick(True), pick(99), pick(1, score=True), pick(1, score=69)]
    result = curation._parse(json.dumps({"items": data}), candidates, [], NOW)
    assert len(result) == 5
    assert [item["score"] for item in result] == [82, 81, 80, 79, 78]
    assert all(item["url"].startswith("https://openai.com/") for item in result)
    assert curation._parse(json.dumps({"items": [pick(event_date="2025-01-01"), pick(event_date="2027-01-01")]}), candidates, [], NOW) == []


def test_same_event_is_merged_across_different_source_urls(home_workspace, pipeline):
    candidates, _ = curation._candidates([ARTICLE, {**ARTICLE, "url": "https://openai.com/index/coverage"}], NOW)
    result = curation._parse(json.dumps({"items": [pick(1, event_key="sdk-launch"), pick(2, event_key="sdk-launch")]}), candidates, [], NOW)
    assert len(result) == 1


def test_empty_rescreen_does_not_erase_history_and_repeat_yesterday(home_workspace, pipeline, monkeypatch):
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    assert service.get_feed(refresh_if_due=False)["curation"]["status"] == "ready"
    pipeline["model_result"] = '{"items":[]}'
    curation.regenerate()
    assert service._load(home_workspace)["curation"]["history"]
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(days=1))
    pipeline["results"] = [{**ARTICLE, "published_at": "2026-10-19T08:00:00Z"}]
    pipeline.pop("model_result")
    service.get_feed()
    assert service.get_feed(refresh_if_due=False)["curation"]["items"] == []


def test_inflight_opt_out_invalidates_work_before_search_and_cache_write(home_workspace, pipeline, monkeypatch):
    runners = []
    monkeypatch.setattr(workspace, "spawn_thread", lambda target, *, args, name: runners.append((name, target, args)))
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    assert curation.regenerate() is False
    service.save_preferences(["MCP"], [], curation_enabled=False)
    for name, target, args in runners:
        if name == "home-curation":
            target(*args)
    assert pipeline["search"] == []
    assert pipeline["model"] == []
    assert service.get_feed(refresh_if_due=False)["curation"]["status"] == "disabled"
    assert not service._load(home_workspace)["curation"].get("cache")


def test_accounts_are_isolated_and_new_account_never_inherits_opt_in(home_workspace, pipeline, tmp_path):
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    with workspace.use_workspace(202, tmp_path / "202"):
        other = service.get_feed(refresh_if_due=False)
        assert other["curation"]["status"] == "disabled"
        assert other["curation"]["items"] == []
    assert service.get_feed(refresh_if_due=False)["curation"]["status"] == "ready"


def test_real_worker_binds_workspace_and_only_one_run_is_reserved(home_workspace, pipeline, monkeypatch):
    original_spawn = REAL_SPAWN
    entered, release = Event(), Event()
    threads, roots = [], []
    original_model = curation._request_model

    def model(connection, prompt):
        roots.append(workspace.current_workspace_root())
        entered.set()
        assert release.wait(3)
        return original_model(connection, prompt)

    def spawn(*args, **kwargs):
        thread = original_spawn(*args, **kwargs)
        threads.append(thread)
        return thread

    monkeypatch.setattr(curation, "_request_model", model)
    monkeypatch.setattr(workspace, "spawn_thread", spawn)
    try:
        service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
        assert entered.wait(3)
        assert curation.regenerate() is False
        assert service.get_feed(refresh_if_due=False)["curation"]["status"] == "generating"
    finally:
        release.set()
        for thread in threads:
            thread.join(timeout=5)
    assert all(not thread.is_alive() for thread in threads)
    assert roots == [home_workspace]
    assert service.get_feed(refresh_if_due=False)["curation"]["status"] == "ready"


def test_new_day_response_reports_running_so_browser_keeps_polling(home_workspace, pipeline, monkeypatch):
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    previous = service.get_feed(refresh_if_due=False)["curation"]
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(days=1))
    monkeypatch.setattr(workspace, "spawn_thread", lambda *args, **kwargs: None)
    result = service.get_feed()["curation"]
    assert result["status"] == "generating"
    assert result["date"] == previous["date"]
    assert result["items"] == previous["items"]

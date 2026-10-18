from __future__ import annotations

import importlib.util
import os
from pathlib import Path


from app.feeds import curation, digest, service
from test_home_curation import home_workspace, pipeline


def test_skill_is_a_real_bundled_resource_and_missing_skill_never_searches(home_workspace, pipeline, tmp_path, monkeypatch):
    guidance = curation._skill()
    assert "正文" in guidance and "event_date" in guidance and "不凑数" in guidance
    monkeypatch.setattr(curation, "SKILL_PATH", tmp_path / "missing.md")
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    assert service.get_feed(refresh_if_due=False)["curation"]["status"] == "error"
    assert pipeline["search"] == []
    assert pipeline["model"] == []


def test_daily_curator_resource_is_in_desktop_packaging_arguments(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("package_sidecar_curation_test", root / "desktop" / "scripts" / "package-sidecar.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    commands = []
    monkeypatch.setattr(module.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(module.platform, "machine", lambda: "arm64")
    monkeypatch.setattr(module, "assert_runtime_only", lambda python: None)
    monkeypatch.setattr(module, "litellm_arguments", lambda python: [])
    monkeypatch.setattr(module, "BINARIES", tmp_path / "binaries")
    monkeypatch.setattr(module.subprocess, "run", lambda args, **kwargs: commands.append(args))
    module.main()
    bundle = next(command for command in commands if "--add-data" in command)
    expected = f"{curation.SKILL_PATH}{os.pathsep}app/agent/skills/daily-news-curator"
    assert expected in bundle
    assert bundle[bundle.index(expected) - 1] == "--add-data"


def test_profile_changed_to_images_is_rejected_before_search(home_workspace, pipeline, monkeypatch):
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    pipeline["search"].clear()
    pipeline["model"].clear()
    monkeypatch.setattr(digest, "_resolve_connection", lambda profile_id: {"model_name": "image-only", "resolved_model_protocol": "images"})
    curation.regenerate()
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "error"
    assert pipeline["search"] == []
    assert pipeline["model"] == []

"""scripts/check-docs-sync.sh: rules hold for long change lists (no SIGPIPE false negative)."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check-docs-sync.sh"
pytestmark = pytest.mark.skipif(shutil.which("git") is None or shutil.which("bash") is None, reason="needs git and bash")


def _repo(tmp_path: Path, files: list[str]) -> tuple[Path, str, str]:
    def git(*args: str) -> str:
        return subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True, text=True).stdout.strip()

    git("init", "-q")
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "base")
    base = git("rev-parse", "HEAD")
    for name in files:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("x\n")
    git("add", "-A")
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "change")
    return tmp_path, base, git("rev-parse", "HEAD")


def _check(tmp_path: Path, files: list[str]) -> subprocess.CompletedProcess[str]:
    repo, base, head = _repo(tmp_path, files)
    return subprocess.run(["bash", str(SCRIPT), base, head], cwd=repo, capture_output=True, text=True)


# Long lists made `echo | grep -q` die with SIGPIPE (141) and read as "no match".
FILLER = [f"frontend/src/generated/file_{index:05}.ts" for index in range(6000)]


@pytest.mark.parametrize("changed", [
    "backend/app/models/litellm_provider.py",
    "backend/requirements-lock.txt",
    "backend/scripts/scan_pth.py",
    ".github/workflows/ci.yml",
])
def test_model_layer_rule_fires_with_long_change_list(tmp_path, changed):
    result = _check(tmp_path, [changed, *FILLER, "docs/agent.md"])
    assert result.returncode == 1 and "docs/model-layer.md" in result.stdout


def test_agent_rule_fires_with_long_change_list(tmp_path):
    result = _check(tmp_path, ["backend/app/agent/runtime.py", *FILLER])
    assert result.returncode == 1 and "docs/agent.md" in result.stdout


def test_passes_when_docs_updated(tmp_path):
    result = _check(tmp_path, ["backend/scripts/install_deps.sh", "backend/app/agent/x.py", *FILLER,
                               "docs/model-layer.md", "docs/agent.md"])
    assert result.returncode == 0, result.stdout[-500:]

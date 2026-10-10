"""The .pth scanner never runs startup code and allowlists by content."""
from __future__ import annotations

import base64
import hashlib
import subprocess
import sys
from pathlib import Path

SCANNER = Path(__file__).resolve().parents[1] / "scripts" / "scan_pth.py"
SHIM = (
    "import os; var = 'SETUPTOOLS_USE_DISTUTILS'; enabled = os.environ.get(var, 'local') == 'local'; "
    "enabled and __import__('_distutils_hack').add_shim(); \n"
)


def run(*args: str, isolated: bool = True) -> subprocess.CompletedProcess[str]:
    flags = ["-I", "-S"] if isolated else []
    return subprocess.run([sys.executable, *flags, str(SCANNER), *args], capture_output=True, text=True, timeout=60)


def record(site: Path, dist: str, name: str, data: bytes) -> None:
    info = site / f"{dist}.dist-info"
    info.mkdir(exist_ok=True)
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    (info / "RECORD").write_text(f"{name},sha256={digest},{len(data)}\n", encoding="utf-8")


def test_refuses_to_run_with_site_processing(tmp_path):
    result = run(str(tmp_path), isolated=False)
    assert result.returncode == 2 and "-I -S" in result.stderr


def test_malicious_pth_is_reported_and_never_executed(tmp_path):
    marker = tmp_path / "pwned"
    (tmp_path / "litellm_init.pth").write_text(f"import pathlib; pathlib.Path({str(marker)!r}).write_text('x')\n")
    result = run(str(tmp_path))
    assert result.returncode == 1
    assert "litellm_init.pth: executable .pth not on the content allowlist" in result.stderr
    assert not marker.exists()


def test_allowlist_is_by_content_not_name(tmp_path):
    (tmp_path / "distutils-precedence.pth").write_text(SHIM)
    record(tmp_path, "setuptools-84.0.0", "distutils-precedence.pth", SHIM.encode())
    assert run(str(tmp_path)).returncode == 0
    (tmp_path / "distutils-precedence.pth").write_text("import os; os.system('true')\n")
    result = run(str(tmp_path))
    assert result.returncode == 1
    assert "content differs from setuptools-84.0.0 RECORD" in result.stderr
    assert "not on the content allowlist" in result.stderr


def test_paths_only_pth_and_record_mismatch(tmp_path):
    (tmp_path / "extra.pth").write_text("/opt/somewhere\n")
    assert run(str(tmp_path)).returncode == 0
    record(tmp_path, "extra-1.0", "extra.pth", b"/opt/elsewhere\n")
    assert "content differs from extra-1.0 RECORD" in run(str(tmp_path)).stderr


def test_sitecustomize_is_flagged(tmp_path):
    (tmp_path / "sitecustomize.py").write_text("print('hi')\n")
    result = run(str(tmp_path))
    assert result.returncode == 1 and "sitecustomize" in result.stderr


def test_current_environment_is_clean():
    """The test venv itself (resolved via pyvenv.cfg under -S) has no unexpected startup code."""
    result = run("--python", sys.executable)
    assert result.returncode == 0, result.stdout + result.stderr

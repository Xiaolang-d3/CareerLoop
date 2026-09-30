#!/usr/bin/env python3
"""Build the FastAPI server into Tauri's target-specific sidecar location.

Run once on every OS/architecture that will receive a release.  Cross-platform
releases must be built on native CI runners because PyInstaller does not cross
compile Python applications.
"""

from __future__ import annotations

import platform
import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
TAURI_ROOT = ROOT / "desktop" / "src-tauri"
BINARIES = TAURI_ROOT / "binaries"
RUNTIME_RESOURCES = TAURI_ROOT / "resources"


def target_triple() -> str:
    system = platform.system()
    machine = platform.machine().lower()
    machine = {"arm64": "aarch64", "amd64": "x86_64"}.get(machine, machine)
    if system == "Darwin":
        return f"{machine}-apple-darwin"
    if system == "Windows":
        return f"{machine}-pc-windows-msvc"
    if system == "Linux":
        return f"{machine}-unknown-linux-gnu"
    raise RuntimeError(f"Unsupported packaging platform: {system}")


def main() -> None:
    if platform.system() != "Darwin":
        raise SystemExit("The current internal desktop package supports macOS only.")
    executable_name = "pyinstaller.exe" if platform.system() == "Windows" else "pyinstaller"
    venv_pyinstaller = BACKEND / ".venv" / ("Scripts" if platform.system() == "Windows" else "bin") / executable_name
    pyinstaller = str(venv_pyinstaller) if venv_pyinstaller.is_file() else shutil.which("pyinstaller")
    if pyinstaller is None:
        raise SystemExit("Install PyInstaller in the backend build environment first.")
    dist = RUNTIME_RESOURCES
    work = ROOT / "desktop" / ".sidecar-build"
    build_env = dict(os.environ)
    build_env["PYINSTALLER_CONFIG_DIR"] = str(ROOT / "desktop" / ".pyinstaller-cache")
    subprocess.run(
        [
            pyinstaller, "--noconfirm", "--clean", "--onedir", "--name", "careerloop-runtime",
            "--paths", str(BACKEND), "--distpath", str(dist), "--workpath", str(work),
            "--specpath", str(work),
            # These are development or optional-model dependencies.  Runtime
            # imports are lazy and already fall back when an optional parser is
            # not installed; including them turns a compact local API into a
            # multi-gigabyte desktop sidecar.
            "--exclude-module", "pytest",
            "--exclude-module", "torch",
            "--exclude-module", "torchvision",
            "--exclude-module", "tensorflow",
            "--exclude-module", "docling",
            "--exclude-module", "docling_core",
            "--exclude-module", "docling_ibm_models",
            "--exclude-module", "transformers",
            "--exclude-module", "fastembed",
            "--exclude-module", "pandas",
            "--exclude-module", "scipy",
            "--exclude-module", "spacy",
            "--exclude-module", "presidio_analyzer",
            "--exclude-module", "presidio_anonymizer",
            # Screenshot OCR is optional and imported lazily.  Shipping its
            # native inference stack adds roughly 70 MB. Keep it available in
            # source/web development and move it to a separately installable
            # desktop component later.
            "--exclude-module", "rapidocr",
            "--exclude-module", "onnxruntime",
            "--exclude-module", "cv2",
            "--exclude-module", "numpy",
            "--exclude-module", "shapely",
            str(BACKEND / "app" / "desktop_server.py"),
        ],
        check=True,
        cwd=BACKEND,
        env=build_env,
    )
    BINARIES.mkdir(parents=True, exist_ok=True)
    destination = BINARIES / f"careerloop-server-{target_triple()}"
    subprocess.run(
        [
            "cc",
            "-arch",
            "arm64",
            "-Os",
            str(TAURI_ROOT / "sidecar-launcher.c"),
            "-o",
            str(destination),
        ],
        check=True,
    )
    print(destination)


if __name__ == "__main__":
    main()

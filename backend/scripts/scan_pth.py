#!/usr/bin/env python3
"""Scan a Python environment's site-packages for startup-executing files.

``.pth`` lines starting with ``import`` run on *every* interpreter start (the
compromised litellm 1.82.7/1.82.8 releases used exactly that), as do
``sitecustomize``/``usercustomize`` modules. Scanning from inside the
environment would run those files before the scan, so this script:

* must itself be started with ``-I -S`` (no site processing: the scanning
  interpreter executes no ``.pth`` at all) and refuses to run otherwise;
* is pointed at the target explicitly: site-packages directories, or
  ``--python X`` which asks X (also with ``-I -S``) for its sysconfig paths;
* allows an executable ``.pth`` only by sha256 of its content, and checks that
  each ``.pth`` matches the hash recorded in its owning package's RECORD.

Usage::

    python3 -I -S backend/scripts/scan_pth.py --python backend/.venv/bin/python
    python3 -I -S backend/scripts/scan_pth.py /path/to/site-packages

Exit codes: 0 clean, 1 unexpected startup code found, 2 usage error.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path

# Reviewed content, keyed by sha256 of the exact file bytes.
ALLOWED_EXECUTABLE_SHA256 = {
    # setuptools 84.0.0 distutils-precedence.pth (_distutils_hack shim)
    "2638ce9e2500e572a5e0de7faed6661eb569d1b696fcba07b0dd223da5f5d224": "setuptools distutils-precedence.pth",
}
STARTUP_MODULES = ("sitecustomize", "usercustomize")
# Under -S, site.py never applies a venv, so resolve pyvenv.cfg ourselves.
_PATHS_SNIPPET = """
import json, os, sys, sysconfig
exe_dir = os.path.dirname(os.path.abspath(sys.executable))
venv = next((c for c in (os.path.dirname(exe_dir), exe_dir) if os.path.isfile(os.path.join(c, "pyvenv.cfg"))), None)
paths = set()
include_system = True
if venv:
    with open(os.path.join(venv, "pyvenv.cfg"), encoding="utf-8") as handle:
        config = {key.strip(): value.strip() for key, value in (line.split("=", 1) for line in handle if "=" in line)}
    include_system = config.get("include-system-site-packages", "false").lower() == "true"
    scheme = "venv" if "venv" in sysconfig.get_scheme_names() else ("nt" if os.name == "nt" else "posix_prefix")
    got = sysconfig.get_paths(scheme=scheme, vars={"base": venv, "platbase": venv})
    paths |= {got["purelib"], got["platlib"]}
if include_system:
    got = sysconfig.get_paths()
    paths |= {got["purelib"], got["platlib"]}
print(json.dumps(sorted(paths)))
"""


def target_site_dirs(python: str) -> list[Path]:
    output = subprocess.run(
        [python, "-I", "-S", "-c", _PATHS_SNIPPET], capture_output=True, text=True, check=True, timeout=60,
    ).stdout
    return [Path(item) for item in json.loads(output)]


def is_executable_line(line: str) -> bool:
    # site.addpackage() execs lines starting with "import " / "import\t";
    # be stricter and also flag indented ones.
    return line.lstrip().startswith(("import ", "import\t"))


def recorded_hashes(directory: Path) -> dict[str, tuple[str, str]]:
    """Top-level file name -> (distribution, urlsafe-b64 sha256) from RECORD files."""
    owners: dict[str, tuple[str, str]] = {}
    for record in directory.glob("*.dist-info/RECORD"):
        dist = record.parent.name.removesuffix(".dist-info")
        try:
            rows = list(csv.reader(record.read_text(encoding="utf-8", errors="replace").splitlines()))
        except csv.Error:
            continue
        for row in rows:
            if len(row) >= 2 and "/" not in row[0] and row[1].startswith("sha256="):
                owners[row[0]] = (dist, row[1].removeprefix("sha256="))
    return owners


def scan(directories: list[Path]) -> tuple[list[str], int]:
    problems: list[str] = []
    found = 0
    for directory in directories:
        if not directory.is_dir():
            continue
        owners = recorded_hashes(directory)
        for path in sorted(directory.glob("*.pth")):
            found += 1
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            text = data.decode("utf-8", errors="replace")
            executable = any(is_executable_line(line) for line in text.splitlines())
            owner = owners.get(path.name)
            label = owner[0] if owner else "no RECORD owner"
            print(f"{'EXECUTABLE' if executable else 'paths-only':10} {path} [{label}] sha256={digest}")
            if owner:
                expected = owner[1]
                actual = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
                if actual != expected:
                    problems.append(f"{path}: content differs from {owner[0]} RECORD")
            if executable and digest not in ALLOWED_EXECUTABLE_SHA256:
                problems.append(f"{path}: executable .pth not on the content allowlist")
        for name in STARTUP_MODULES:
            for candidate in (directory / f"{name}.py", directory / name):
                if candidate.exists():
                    problems.append(f"{candidate}: {name} runs on every interpreter start")
    return problems, found


def main(argv: list[str]) -> int:
    if not (sys.flags.no_site and sys.flags.isolated):
        print("scan_pth.py must run as `python -I -S scan_pth.py ...` so no .pth executes before the scan",
              file=sys.stderr)
        return 2
    directories: list[Path] = []
    arguments = list(argv)
    while arguments:
        item = arguments.pop(0)
        if item == "--python":
            if not arguments:
                print("--python needs an interpreter path", file=sys.stderr)
                return 2
            directories += target_site_dirs(arguments.pop(0))
        else:
            directories.append(Path(item))
    if not directories:
        print(__doc__, file=sys.stderr)
        return 2
    problems, found = scan(list(dict.fromkeys(directories)))
    print(f"{found} .pth file(s) scanned in {len(directories)} director(ies)")
    if problems:
        print("Unexpected startup code:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

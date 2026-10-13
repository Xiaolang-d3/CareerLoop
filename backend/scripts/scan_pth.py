#!/usr/bin/env python3
"""Scan a Python environment's site-packages for startup-executing files.

At interpreter start, ``site`` processes every ``*.pth`` in each site-packages
directory: lines starting with ``import`` are executed (the compromised
litellm 1.82.7/1.82.8 releases used exactly that) and other lines add
directories to ``sys.path``, after which ``sitecustomize``/``usercustomize``
are imported from *anywhere* on the path. Scanning from inside the environment
would run all of that before the scan, so this script:

* must itself be started with ``-I -S`` (no site processing) and refuses
  otherwise;
* is pointed at the target explicitly: site-packages directories, or
  ``--python X`` which asks X (also with ``-I -S``) for its sysconfig paths;
* requires every ``.pth`` to be listed, with a matching hash, in an installed
  distribution's RECORD (an unowned file is never trusted, even if its bytes
  equal an allowlisted one);
* decodes ``.pth`` files as UTF-8 with an optional BOM, exactly like ``site``
  does first, and rejects files that are not valid UTF-8 (``site`` would fall
  back to the locale encoding);
* allows an *executable* ``.pth`` only if its sha256 and owning distribution
  are on the allowlist and that distribution's whole RECORD verifies (so the
  module it imports, e.g. ``_distutils_hack``, is the reviewed one);
* rejects ``sitecustomize``/``usercustomize`` (any form) in the site
  directories and in every directory a ``.pth`` adds to ``sys.path``, and
  rejects a ``.pth`` that adds a regular file (a zip is imported from via
  zipimport, so a ``sitecustomize`` inside it would run).

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
import os
import subprocess
import sys
from pathlib import Path

# Reviewed executable .pth content: sha256 of the exact bytes -> owning distribution.
ALLOWED_EXECUTABLE = {
    # setuptools 84.0.0 distutils-precedence.pth (imports _distutils_hack from setuptools' own RECORD)
    "2638ce9e2500e572a5e0de7faed6661eb569d1b696fcba07b0dd223da5f5d224": "setuptools",
}
STARTUP_MODULES = ("sitecustomize", "usercustomize")

# Under -S, site.py never applies a venv, so resolve pyvenv.cfg ourselves.
_PATHS_SNIPPET = """
import json, os, site, sys, sysconfig
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
    if not venv:
        paths.add(site.getusersitepackages())  # processed at startup unless -s/-I
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


def _record_digest(data: bytes) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()


class Records:
    """Every RECORD row in one site-packages directory."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.owner: dict[str, tuple[str, str]] = {}  # normalized relative path -> (dist-info dir, hash)
        self.rows: dict[str, list[tuple[str, str]]] = {}  # dist-info dir -> [(relative path, hash)]
        for record in sorted(directory.glob("*.dist-info/RECORD")):
            dist = record.parent.name.removesuffix(".dist-info")
            try:
                rows = list(csv.reader(record.read_text(encoding="utf-8").splitlines()))
            except (csv.Error, UnicodeDecodeError):
                continue
            entries = []
            for row in rows:
                if len(row) >= 2 and row[1].startswith("sha256="):
                    relative = os.path.normpath(row[0])
                    entries.append((relative, row[1].removeprefix("sha256=")))
                    self.owner.setdefault(relative, (dist, row[1].removeprefix("sha256=")))
            self.rows[dist] = entries

    @staticmethod
    def project(dist_info: str) -> str:
        return dist_info.rsplit("-", 1)[0].lower().replace("_", "-")

    def verify_distribution(self, dist_info: str) -> list[str]:
        problems = []
        for relative, expected in self.rows.get(dist_info, []):
            if relative.startswith(".."):
                continue  # console scripts outside site-packages
            path = self.directory / relative
            try:
                actual = _record_digest(path.read_bytes())
            except OSError:
                problems.append(f"{path}: listed in {dist_info} RECORD but missing")
                continue
            if actual != expected:
                problems.append(f"{path}: content differs from {dist_info} RECORD")
        return problems


def startup_modules_in(directory: Path) -> list[Path]:
    found = []
    try:
        entries = list(directory.iterdir())
    except OSError:
        return found
    for entry in entries:
        if entry.name.split(".", 1)[0] in STARTUP_MODULES:
            found.append(entry)
    return found


def added_paths(site_dir: Path, text: str) -> list[Path]:
    """Existing paths site.addpackage() would add for the non-import lines.

    site adds any path that exists, including a regular file: a zip there is
    imported from via zipimport (sitecustomize inside it runs at startup), so
    callers reject everything that is not a directory.
    """
    paths = []
    for line in text.splitlines():
        stripped = line.rstrip()
        if not stripped or stripped.startswith("#") or is_executable_line(line):
            continue
        candidate = (site_dir / stripped).resolve() if not os.path.isabs(stripped) else Path(stripped).resolve()
        if candidate.exists():
            paths.append(candidate)
    return paths


def scan(directories: list[Path]) -> tuple[list[str], int]:
    problems: list[str] = []
    found = 0
    for directory in directories:
        if not directory.is_dir():
            continue
        records = Records(directory)
        for module in startup_modules_in(directory):
            problems.append(f"{module}: runs on every interpreter start")
        for path in sorted(directory.glob("*.pth")):
            found += 1
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            owner = records.owner.get(path.name)
            label = owner[0] if owner else "no RECORD owner"
            try:
                text = data.decode("utf-8-sig")  # site.addpackage decodes this way first
            except UnicodeDecodeError:
                text = None
            executable = text is None or any(is_executable_line(line) for line in text.splitlines())
            print(f"{'EXECUTABLE' if executable else 'paths-only':10} {path} [{label}] sha256={digest}")
            if owner is None:
                problems.append(f"{path}: not listed in any installed distribution's RECORD")
            elif _record_digest(data) != owner[1]:
                problems.append(f"{path}: content differs from {owner[0]} RECORD")
            if text is None:
                problems.append(f"{path}: not valid UTF-8 (site would decode it with the locale encoding)")
                continue
            if executable:
                allowed_project = ALLOWED_EXECUTABLE.get(digest)
                if allowed_project is None:
                    problems.append(f"{path}: executable .pth not on the content allowlist")
                elif owner is None or Records.project(owner[0]) != allowed_project:
                    problems.append(f"{path}: allowlisted content but not owned by {allowed_project}")
                else:
                    problems.extend(records.verify_distribution(owner[0]))
            for added in added_paths(directory, text):
                if not added.is_dir():
                    problems.append(f"{added}: file added to sys.path by {path.name} (zipimport could run "
                                    "sitecustomize from it); only directories are allowed")
                    continue
                for module in startup_modules_in(added):
                    problems.append(f"{module}: added to sys.path by {path.name}; runs on every interpreter start")
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
        print("Unexpected startup code:\n  " + "\n  ".join(dict.fromkeys(problems)), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

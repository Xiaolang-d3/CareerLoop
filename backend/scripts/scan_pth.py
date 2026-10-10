#!/usr/bin/env python3
"""List every ``.pth`` file in this interpreter's site-packages.

``.pth`` lines that start with ``import`` run code on *every* interpreter start;
the compromised litellm 1.82.7/1.82.8 releases used exactly that.  Exit 1 when
an executable ``.pth`` appears that is not on the small allowlist below.
"""
from __future__ import annotations

import site
import sys
from pathlib import Path

# setuptools' own shim; reviewed and expected on many interpreters.
ALLOWED_EXECUTABLE = {"distutils-precedence.pth"}


def site_dirs() -> list[Path]:
    dirs = list(site.getsitepackages()) if hasattr(site, "getsitepackages") else []
    user = site.getusersitepackages() if hasattr(site, "getusersitepackages") else None
    if user:
        dirs.append(user)
    return [Path(item) for item in dict.fromkeys(dirs) if Path(item).is_dir()]


def main() -> int:
    unexpected: list[str] = []
    found = 0
    for directory in site_dirs():
        for path in sorted(directory.glob("*.pth")):
            found += 1
            lines = [line.strip() for line in path.read_text(encoding="utf-8", errors="replace").splitlines()]
            executable = [line for line in lines if line.startswith(("import ", "import\t"))]
            kind = "EXECUTABLE" if executable else "paths-only"
            print(f"{kind:10} {path}")
            if executable and path.name not in ALLOWED_EXECUTABLE:
                unexpected.append(str(path))
    print(f"{found} .pth file(s) scanned")
    if unexpected:
        print("Unexpected executable .pth files:\n  " + "\n  ".join(unexpected), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

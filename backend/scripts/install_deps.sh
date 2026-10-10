#!/bin/sh
# Install backend dependencies only from the hash-locked file
# (requirements-lock.txt; see docs/model-layer.md).
#
# --force-reinstall matters: pip skips packages that are already installed at
# the pinned version *without* checking their hashes, so an existing venv
# would otherwise keep whatever it had. The reinstall runs only when the lock
# changes (stamp file in the venv).
set -eu
BACKEND_DIR=$(cd "$(dirname "$0")/.." && pwd)
VENV="${1:-$BACKEND_DIR/.venv}"
LOCK="$BACKEND_DIR/requirements-lock.txt"
STAMP="$VENV/.requirements-lock.sha256"

if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
SUM=$( (shasum -a 256 "$LOCK" 2>/dev/null || sha256sum "$LOCK") | cut -d ' ' -f 1)
if [ "$(cat "$STAMP" 2>/dev/null || true)" != "$SUM" ]; then
  env -u PYTHONPATH -u VIRTUAL_ENV -u PYTHONHOME "$VENV/bin/python" -m pip install -q \
    --require-hashes --no-deps --only-binary :all: --force-reinstall -r "$LOCK"
  # Scan before anything starts this venv normally: -I -S processes no .pth.
  if ! "$VENV/bin/python" -I -S "$BACKEND_DIR/scripts/scan_pth.py" --python "$VENV/bin/python"; then
    echo "Unexpected startup code in $VENV; do not use it. Remove the venv and investigate." >&2
    exit 1
  fi
  echo "$SUM" > "$STAMP"
fi

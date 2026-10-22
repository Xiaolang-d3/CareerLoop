#!/usr/bin/env bash
# Keep the existing CI entry point, but enforce local-only documentation.
# Usage: scripts/check-docs-sync.sh <base-sha> <head-sha>
set -euo pipefail
HEAD_SHA="${2:?Usage: scripts/check-docs-sync.sh <base-sha> <head-sha>}"
TRACKED_DOCS="$(git ls-tree -r --name-only "$HEAD_SHA" -- docs)"
if [[ -n "$TRACKED_DOCS" ]]; then
  echo "::error::docs/ 仅在本地维护，不得纳入 Git。请使用 git rm -r --cached docs 保留本地文件并停止跟踪。"
  printf '%s\n' "$TRACKED_DOCS"
  exit 1
fi
echo "docs/ 未被 Git 跟踪。"

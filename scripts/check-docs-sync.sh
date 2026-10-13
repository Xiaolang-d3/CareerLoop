#!/usr/bin/env bash
# Fail when code that docs describe changes without the matching doc.
# Usage: scripts/check-docs-sync.sh <base-sha> <head-sha>
# Three-dot diff: only what the PR branch changed since it forked from base,
# not unrelated commits that landed on base meanwhile.
# Match with here-strings, not `echo "$CHANGED" | grep -q`: under pipefail,
# grep -q exits on the first match, echo gets SIGPIPE on a long list (141)
# and the whole pipeline reads as "no match".
set -euo pipefail
BASE_SHA="$1"
HEAD_SHA="$2"
CHANGED="$(git diff --name-only "$BASE_SHA...$HEAD_SHA")"
echo "$CHANGED"
status=0

AGENT_CODE='^backend/app/((agent|tools|chat|api|library|documents|persistence|compatibility|models|observability)/|(db|schema|upgrades|model_protocol|redaction)\.py$)'
if grep -Eq "$AGENT_CODE" <<<"$CHANGED"; then
  if ! grep -qx 'docs/agent.md' <<<"$CHANGED"; then
    echo "::error::智能体、聊天、资料库、解析、API、模型层、监控、数据库或迁移代码有变更时，同一 PR 必须更新 docs/agent.md"
    status=1
  fi
fi

# Model layer, dependency locks, install/scan scripts and CI workflows (which
# carry the hash-locked install and .pth scan steps) are described there.
MODEL_LAYER='^(backend/(app/models/litellm_[a-z_]+\.py|requirements[a-z-]*\.(txt|in)|scripts/.+)|\.github/workflows/.+)$'
if grep -Eq "$MODEL_LAYER" <<<"$CHANGED"; then
  if ! grep -qx 'docs/model-layer.md' <<<"$CHANGED"; then
    echo "::error::LiteLLM 模型层、后端依赖、backend/scripts 或 CI 工作流有变更时，同一 PR 必须更新 docs/model-layer.md"
    status=1
  fi
fi
exit "$status"

#!/usr/bin/env bash
# Fail when code that docs describe changes without the matching doc.
# Usage: scripts/check-docs-sync.sh <base-sha> <head-sha>
# Three-dot diff: only what the PR branch changed since it forked from base,
# not unrelated commits that landed on base meanwhile.
set -euo pipefail
BASE_SHA="$1"
HEAD_SHA="$2"
CHANGED="$(git diff --name-only "$BASE_SHA...$HEAD_SHA")"
echo "$CHANGED"
status=0

AGENT_CODE='^backend/app/((agent|tools|chat|api|library|documents|persistence|compatibility|models|observability)/|(db|schema|upgrades|model_protocol|redaction)\.py$)'
if echo "$CHANGED" | grep -Eq "$AGENT_CODE"; then
  if ! echo "$CHANGED" | grep -qx 'docs/agent.md'; then
    echo "::error::智能体、聊天、资料库、解析、API、模型层、监控、数据库或迁移代码有变更时，同一 PR 必须更新 docs/agent.md"
    status=1
  fi
fi

MODEL_LAYER='^backend/(app/models/litellm_[a-z_]+\.py|requirements[a-z-]*\.(txt|in))$'
if echo "$CHANGED" | grep -Eq "$MODEL_LAYER"; then
  if ! echo "$CHANGED" | grep -qx 'docs/model-layer.md'; then
    echo "::error::LiteLLM 模型层或后端依赖有变更时，同一 PR 必须更新 docs/model-layer.md"
    status=1
  fi
fi
exit "$status"

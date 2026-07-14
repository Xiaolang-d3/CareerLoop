# BossCopilot Model Provider Architecture

## Decision

BossCopilot will use a GPT model first, but the core agent workflow must stay model-provider agnostic.

The system should not hard-code GPT-specific behavior into:

- workflow node contracts
- tool definitions
- chat message storage
- job/application data models
- browser automation tools

## Layers

```text
Chat UI
  -> Agent Planner
  -> Model Provider Adapter
  -> Tool Registry
  -> LangGraph Workflow Runtime
  -> SQLite/Postgres State
```

## Model Provider Adapter

All models should implement the same internal interface:

```text
input:
  - conversation messages
  - current workflow state
  - available tools
  - tool result history

output:
  - assistant message
  - optional tool call requests
  - structured reasoning summary for logs
```

Provider-specific details stay inside adapters:

- OpenAI/GPT adapter
- Anthropic adapter
- local model adapter
- other OpenAI-compatible API adapter

## Tool Contract

Tools should be plain structured functions with model-neutral schemas.

Example tools:

- `open_boss_page`
- `check_login_status`
- `inspect_current_page`
- `collect_visible_jobs`
- `summarize_jobs`
- `generate_message`
- `request_user_confirmation`

Each tool returns structured output:

```json
{
  "ok": true,
  "status": "done",
  "data": {},
  "message": "Human-readable summary"
}
```

## Configuration

Model choice should come from environment/config, not source edits:

```text
MODEL_PROVIDER=openai
MODEL_NAME=<configured GPT model>
OPENAI_API_KEY=<secret>
MODEL_BASE_URL=<optional OpenAI-compatible endpoint>
```

Only the configured provider is registered at runtime. The application does not silently switch to a fake, cheaper, or alternate model. Authentication failures, rate limits, timeouts, connection failures, and upstream error responses must become structured Agent failures and visible UI alerts.

## Current Plan

1. Use GPT as the first planner model.
2. Keep LangGraph as the workflow runtime.
3. Keep browser/BOSS actions as normal tools.
4. Store model/tool events in workflow/chat payloads.
5. Add other model providers by implementing the same adapter interface.

# BossCopilot Implementation Roadmap

## Delivery rule

Architecture documentation and contracts are completed before business implementation. Each phase is delivered in a focused Git commit or short commit series and must pass its verification commands before moving to the next phase.

## Current execution priority

The current priority is a working end-to-end feature flow. A comprehensive automated test suite, repository-wide database refactor, migration framework, and CI pipeline are deferred to Phase 6. Each functional commit still requires Python import/compile verification, a manual API smoke check when relevant, frontend production build verification, and `git diff --check`.

The current flow uses BOSS Zhipin as its only runtime data source and covers job search, normalization, SQLite deduplication, and deterministic ranking. The OpenAI-compatible provider supports configuration-driven model and Base URL selection. Model or platform failures are surfaced explicitly and never trigger a silent fallback.

## Phase 0: Documentation baseline

Deliverables:

- Technical architecture and module boundaries
- Git workflow and commit policy
- Development environment and editor guidance
- Implementation phases and acceptance criteria

Exit criteria:

- Documentation is linked from the README.
- Documentation is committed independently of application code.

## Phase 1: Neutral contracts and registries

Deliverables:

- Domain models for jobs, searches, match results, applications, approvals, model messages, and tool calls
- `ModelProvider`, `JobPlatform`, and tool handler protocols
- Model, platform, and tool registries
- Typed configuration with environment loading
- Repository layer around existing SQLite access

Compatibility:

- Existing read APIs continue working during migration.
- Existing SQLite data is not deleted or rewritten.
- The old browser controller is not expanded in this phase.

Exit criteria:

- Core modules contain no OpenAI, BOSS, Playwright, or HTTP-specific imports.
- Duplicate provider/platform registration and unknown lookups return explicit errors.
- The configured provider, platform, and tools can be inspected through the runtime capability endpoint.

## Phase 2: Agent runtime

Deliverables:

- Deterministic job fixtures isolated to future tests and never registered at runtime
- Tool registry with argument validation and structured results
- Agent runtime with maximum rounds, per-tool timeout, cancellation, and event persistence
- Deterministic model fixtures isolated to future tests, never registered as a runtime fallback
- LangGraph workflow for goal, search, collection, analysis, shortlist, and approval pause

Exit criteria:

- A complete job-search conversation runs without network or BOSS access.
- The runtime handles sequential and multiple tool calls.
- Invalid tools, invalid arguments, timeouts, and round exhaustion terminate safely.
- Every model call and tool call has a run ID and traceable result.

## Phase 3: OpenAI provider

Deliverables:

- OpenAI Responses API adapter
- Function-call conversion to and from neutral tool types
- Structured outputs for analysis and ranking
- Timeout, retryable error, rate-limit, and authentication error mapping
- Usage and latency metadata without secrets

Exit criteria:

- Provider selection and model name are configuration-only changes.
- OpenAI SDK types do not escape the adapter.
- Provider contract fixtures remain isolated from production runtime registration.
- A gated integration test verifies one model response and one tool-call round.

## Phase 4: Read-only BOSS adapter

Deliverables:

- Persistent local browser session
- Login-state, CAPTCHA, and unexpected-page detection
- Search navigation and visible job collection
- Job detail parsing and normalization
- Raw-page mapping isolated behind the BOSS adapter

Exit criteria:

- The adapter never attempts to bypass login or CAPTCHA.
- Selector failures produce structured platform errors and diagnostic events.
- The core flow uses the BOSS adapter exclusively and returns structured blocks when BOSS is unavailable.
- Parsed fixtures have regression tests that do not require live BOSS access.

## Phase 5: Approval and assisted application

Deliverables:

- Application draft generation
- Approval request API and UI
- Single-use, expiring approval tokens bound to reviewed content
- BOSS external-write executor behind policy checks
- Application and audit history

Exit criteria:

- No external write works without valid approval.
- Changed, expired, reused, or mismatched approvals are rejected.
- CAPTCHA, login loss, warning pages, and platform limits pause the workflow.
- The user can see exactly what was attempted and the resulting state.

## Phase 6: Product hardening

Deliverables:

- Frontend feature modules and error states
- Database migrations
- Evaluation set for job extraction, analysis, and ranking
- Log redaction, retention rules, backup/export, and recovery documentation
- CI checks for backend tests and frontend type/build verification

Exit criteria:

- A clean checkout can be configured and verified from documented commands.
- Core flows have automated regression coverage.
- Sensitive local data is absent from Git and redacted from diagnostics.

# BossCopilot Technical Architecture

## 1. Purpose

BossCopilot is a modular job-search agent. The first production integrations are BOSS Zhipin and OpenAI, but neither platform-specific browser behavior nor provider-specific model objects may enter the agent core.

The first delivery target is a local, single-user application that can understand a job-search goal, search and normalize jobs, analyze and rank them, and pause for user approval before any external write action.

## 2. Architecture principles

1. **Provider neutral**: the core depends on internal model request/response types, not an OpenAI SDK type.
2. **Platform neutral**: the core works with normalized job and application types, not BOSS page structures.
3. **Tools are the execution boundary**: the model proposes tool calls; the runtime validates and executes them.
4. **Human approval for external writes**: messages, resume submissions, and applications require an approval token.
5. **Observable and recoverable**: model calls, tool calls, workflow transitions, and failures are persisted as events.
6. **Capability driven**: platforms and models declare supported capabilities; the runtime does not assume parity.
7. **Local-first privacy**: browser profiles, API keys, resumes, and runtime databases stay outside Git.
8. **No silent model fallback**: provider failures stop the current Agent run and surface an actionable alert.

## 3. System context

```text
React Web UI
  -> FastAPI API
  -> Agent Runtime
       -> Model Provider Registry -> OpenAI Provider / future providers
       -> Tool Registry
            -> Platform Registry -> Mock / BOSS / future platforms
            -> Domain Services -> matching / applications / approvals
       -> LangGraph workflow
       -> Repositories -> SQLite
```

The application remains a modular monolith for the first version. Module boundaries must be explicit, but separate services, Redis, PostgreSQL, and remote browser workers are deferred until a multi-user deployment is required.

## 4. Module boundaries

### API

Owns HTTP validation, authentication when introduced, response mapping, and streaming. It does not contain SQL, browser selectors, model prompts, or business decisions.

### Agent runtime

Owns the model/tool loop:

1. Load conversation and workflow state.
2. Resolve the configured model provider.
3. Provide only permitted tools to the model.
4. Validate returned tool calls.
5. Execute tools with timeouts and policy checks.
6. Persist model and tool events.
7. Continue until a final response, approval pause, error, or round limit.

LangGraph owns durable workflow transitions. It must call internal services and tools instead of platform implementations directly.

### Model providers

All providers implement one internal protocol:

```python
class ModelProvider(Protocol):
    name: str

    async def generate(self, request: ModelRequest) -> ModelResponse:
        ...
```

Required internal types:

- `ModelRequest`: messages, tool definitions, optional output schema, model options.
- `ModelResponse`: assistant content, tool calls, structured output, usage, provider metadata.
- `ToolDefinition`: neutral name, description, and JSON input schema.
- `ToolCall`: internal call ID, tool name, and validated arguments.

The OpenAI-compatible adapter converts between provider objects and these types. It currently uses Chat Completions because the configured compatible gateway has been verified for text generation and function tool calls on that endpoint. The adapter boundary allows a later switch to Responses API without changing the agent runtime. Provider-specific IDs and raw responses may be stored only as optional diagnostic metadata.

### Recruitment platforms

All platform adapters implement a capability-aware protocol:

```python
class JobPlatform(Protocol):
    name: str

    def capabilities(self) -> PlatformCapabilities: ...
    async def start_session(self) -> SessionStatus: ...
    async def check_auth(self) -> AuthStatus: ...
    async def search_jobs(self, query: JobSearchQuery) -> list[JobSummary]: ...
    async def get_job_detail(self, external_id: str) -> Job: ...
    async def prepare_application(self, external_id: str) -> ApplicationDraft: ...
    async def submit_application(
        self, draft: ApplicationDraft, approval_token: str
    ) -> ApplicationResult: ...
```

`PlatformCapabilities` covers job search, job-detail reading, recruiter status, greeting, resume submission, application submission, and conversation tracking.

The BOSS adapter is internally divided into browser session, page parser, normalized mapper, and action executor. Selectors and BOSS URLs must stay inside that adapter.

### Tools

Tools expose domain actions rather than browser operations:

- `search_jobs`
- `get_job_detail`
- `analyze_job`
- `rank_jobs`
- `prepare_application`
- `request_application_approval`
- `submit_application`
- `update_application_status`

Every handler returns:

```python
class ToolResult(BaseModel):
    ok: bool
    status: Literal["done", "failed", "waiting_approval", "blocked"]
    data: dict = {}
    message: str
    error: ToolError | None = None
```

Unknown tools, invalid arguments, unavailable capabilities, expired approvals, timeouts, and platform blocks return structured failures. They do not crash the runtime.

### Domain and persistence

Canonical domain objects include:

- Candidate profile and job preferences
- Job, salary range, recruiter information, and source reference
- Match result with score, evidence, risks, and recommendation
- Application draft, approval request, and application result
- Agent run, message, tool call, workflow event, and audit event

Normalized fields support cross-platform behavior. A `raw` object retains noncanonical source data without making business logic depend on it.

Existing business tables remain during migration. New runtime tables are additive:

- `agent_runs`
- `agent_messages`
- `tool_calls`
- `platform_sessions`
- `approval_requests`
- `audit_events`

Schema changes require versioned migrations before a cloud or multi-user release.

## 5. Approval and safety model

The following operations always require explicit approval:

- Send or modify an external greeting/message
- Submit a resume
- Submit or withdraw an application
- Execute a batch of external write actions

An approval token is single-use, expires, and binds user/session, platform, job, action, and a hash of the reviewed content. Any changed content invalidates the token.

CAPTCHA, login loss, unexpected navigation, selector failure, platform warning, or rate-limit warning pauses execution and records an audit event. The system does not bypass CAPTCHA or platform controls.

## 6. Configuration

Configuration comes from environment variables or a local ignored `.env` file:

```text
MODEL_PROVIDER=openai
MODEL_NAME=<configured-model>
OPENAI_API_KEY=<secret>
MODEL_BASE_URL=<optional-compatible-api-root>
MODEL_MAX_TOOL_ROUNDS=5
MODEL_TIMEOUT_SECONDS=60

JOB_PLATFORM=mock
DATABASE_URL=sqlite:///...
```

Secrets, browser profiles, databases, logs, screenshots containing personal data, and generated resumes must not be committed.

`MODEL_BASE_URL` may be the gateway root or an explicit `/v1` URL; the adapter normalizes it internally. Omitting it uses the OpenAI SDK default endpoint. Local credentials belong in `backend/.env`, which is ignored by Git. The committed `backend/.env.example` contains names only and must never contain a real key.

## 7. Initial request flow

```text
User goal
  -> runtime selects search tools
  -> platform searches jobs
  -> adapter normalizes results
  -> analysis service/model creates evidence-backed match results
  -> runtime ranks candidates
  -> UI presents shortlist
  -> user selects jobs
  -> runtime prepares drafts
  -> approval request pauses execution
  -> approved platform action executes
  -> application and audit events are stored
```

## 8. Deferred architecture

The following are intentionally out of the first architecture implementation:

- Multi-tenant accounts and billing
- Remote browser farms
- Fully autonomous batch applications
- CAPTCHA solving or login bypass
- Microservices, Redis queues, and distributed locks
- Simultaneous implementation of multiple real recruitment platforms

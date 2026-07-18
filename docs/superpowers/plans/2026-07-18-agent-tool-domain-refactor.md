# Agent Tool Domain Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BossCopilot's partially unreachable, SQL-owning Agent tools with thin, auditable tool adapters over shared domain services, while moving deterministic UI actions to REST APIs and preserving the local-first safety boundary.

**Architecture:** Introduce focused query, analysis, evidence, triage, and application services backed by repositories. REST endpoints and Agent tools call the same services; model-visible tools pass stable `job_id` values and user intent, while `ToolContext` supplies conversation, task, profile, and audit scope. Migrate incrementally so every task leaves the backend test suite passing and old model-visible tools are hidden only after replacements, routing, UI, and tests are ready.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic 2, SQLite, sqlite-vec, AG-UI, React 19, TypeScript 5.7, Vite 6, Vitest, Testing Library.

---

## File map

### New backend files

- `backend/app/services/job_query.py` — authoritative local-job lookup and ambiguity handling.
- `backend/app/services/job_analysis.py` — ranking, match analysis, resume-gap analysis, and derived-result upsert.
- `backend/app/services/evidence.py` — citation-shaped local evidence retrieval with retrieval-mode reporting.
- `backend/app/services/job_triage.py` — idempotent inbox/shortlisted/dismissed decisions.
- `backend/app/services/applications.py` — draft, queue, and factual progress operations keyed by `job_id`.
- `backend/app/repositories/applications.py` — application persistence and uniqueness operations.
- `backend/app/repositories/matches.py` — current-version match-result upsert.
- `backend/app/tools/search_local_jobs.py` — model-facing fuzzy local job search.
- `backend/app/tools/rank_local_jobs.py` — model-facing local-library ranking.
- `backend/app/tools/analyze_job_match.py` — model-facing single-job match analysis.
- `backend/app/tools/search_local_evidence.py` — model-facing evidence retrieval.
- `backend/app/tools/set_job_triage.py` — model-facing reversible job decision.
- `backend/app/tools/record_application_progress.py` — model-facing factual progress update by `job_id`.
- `backend/tests/test_tool_refactor_schema.py` — additive schema and uniqueness migration coverage.
- `backend/tests/test_job_query_service.py` — lookup, scope, and ambiguity coverage.
- `backend/tests/test_job_analysis_service.py` — rank, match upsert, and redacted gap coverage.
- `backend/tests/test_evidence_service.py` — source filtering and retrieval-mode coverage.
- `backend/tests/test_job_triage_service.py` — state mapping, timestamps, and idempotency.
- `backend/tests/test_application_service.py` — single-record queue/progress behavior.
- `backend/tests/test_agent_routing_matrix.py` — positive, negative, negated, compound, and UI prompt routing cases.
- `backend/tests/test_workflow_counts.py` — distinct current-job workflow aggregation.
- `backend/tests/test_agent_bootstrap.py` — exact model-visible tool inventory without network calls.

### New frontend files

- `frontend/src/features/jobs/actions.ts` — typed REST helpers for deterministic job/application actions.
- `frontend/src/features/jobs/JobAssistantActions.tsx` — isolated job action controls.
- `frontend/src/features/applications/ApplicationProgressActions.tsx` — explicit factual progress controls.
- `frontend/src/features/jobs/actions.test.ts` — request contract coverage.
- `frontend/src/features/jobs/JobAssistantActions.test.tsx` — shortlist bypasses Agent coverage.
- `frontend/src/features/applications/ApplicationProgressActions.test.tsx` — progress callback coverage.
- `frontend/src/test/setup.ts` — Testing Library setup.

### Backend files to modify

- `backend/app/db.py` — additive columns, derived-result deduplication, and uniqueness indexes.
- `backend/app/domain/agent.py` — risk enum and result contract support.
- `backend/app/domain/jobs.py` — local-job search and ranking result models.
- `backend/app/repositories/jobs.py` — local lookup/list/triage persistence.
- `backend/app/repositories/__init__.py` — repository exports.
- `backend/app/services/__init__.py` — service exports.
- `backend/app/services/jobs.py` — delegate existing endpoints to new services where applicable.
- `backend/app/tools/base.py` — richer system-owned `ToolContext`.
- `backend/app/tools/get_job_detail.py` — ID-only adapter.
- `backend/app/tools/get_candidate_context.py` — remove model-visible `profile_id`.
- `backend/app/tools/analyze_resume_gap.py` — delegate to analysis service and use `job_id`.
- `backend/app/tools/save_greeting_draft.py` — delegate to application service and use `job_id`.
- `backend/app/tools/queue_application.py` — delegate to application service and use `job_id`.
- `backend/app/tools/request_manual_job_import.py` — retain behavior and new risk name.
- `backend/app/tools/__init__.py` — export replacements and stop exporting retired tools.
- `backend/app/agent/orchestration.py` — intent-to-capability routing and new risk taxonomy.
- `backend/app/agent/runtime.py` — pass active profile and tool call ID through context.
- `backend/app/agent/bootstrap.py` — register only new model-visible tools.
- `backend/app/models/openai_compatible.py` — update system prompt and tool sequence guidance.
- `backend/app/api/schemas.py` — triage, queue, and progress request models.
- `backend/app/api/resources.py` — deterministic REST endpoints.
- `backend/app/workflow/engine.py` — count distinct current analyses/applications correctly.
- `backend/tests/test_local_tools.py` — migrate end-to-end tool flow to new contracts.
- `backend/tests/test_agent_runtime.py` — migrate fake tool names and context assertions.
- `backend/tests/test_chat_streaming.py` — API and AG-UI regression updates.

### Frontend files to modify

- `frontend/package.json` — Vitest and Testing Library scripts/dependencies.
- `frontend/vite.config.ts` — Vitest jsdom configuration.
- `frontend/src/types.ts` — triage and progress result types.
- `frontend/src/constants.ts` — new tool names and descriptions.
- `frontend/src/components/WorkspaceViews.tsx` — use progress action component.
- `frontend/src/main.tsx` — direct deterministic actions and structured `job_id` prompts.

### Documentation files to modify

- `README.md` — final tool inventory and REST endpoints.
- `docs/technical-architecture.md` — service/tool adapter architecture and risk classes.
- `docs/model-provider-architecture.md` — new model-visible tools and parameters.
- `docs/implementation-roadmap.md` — mark tool-domain refactor outcomes.

---

### Task 1: Add additive schema and uniqueness guarantees

**Files:**
- Modify: `backend/app/db.py:105-318`
- Create: `backend/tests/test_tool_refactor_schema.py`

- [ ] **Step 1: Write failing schema tests**

Create `backend/tests/test_tool_refactor_schema.py`:

```python
from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.db import connect, init_db


class ToolRefactorSchemaTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        init_db(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_new_columns_exist(self) -> None:
        with connect(self.db_path) as conn:
            job_columns = {row["name"] for row in conn.execute("PRAGMA table_info(jobs)")}
            match_columns = {row["name"] for row in conn.execute("PRAGMA table_info(match_results)")}
        self.assertIn("updated_at", job_columns)
        self.assertIn("triage_updated_at", job_columns)
        self.assertIn("analysis_version", match_columns)
        self.assertIn("updated_at", match_columns)

    def test_match_version_is_unique_per_job_and_profile(self) -> None:
        with connect(self.db_path) as conn:
            profile_id = conn.execute(
                "INSERT INTO profiles (name) VALUES ('候选人')"
            ).lastrowid
            job_id = conn.execute(
                "INSERT INTO jobs (source_url, title, company) VALUES ('manual://one', '岗位', '公司')"
            ).lastrowid
            values = (job_id, profile_id, 80, "recommended", "job-match-v1")
            conn.execute(
                """
                INSERT INTO match_results (job_id, profile_id, score, level, analysis_version)
                VALUES (?, ?, ?, ?, ?)
                """,
                values,
            )
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    """
                    INSERT INTO match_results (job_id, profile_id, score, level, analysis_version)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    values,
                )

    def test_application_is_unique_per_job_and_profile(self) -> None:
        with connect(self.db_path) as conn:
            profile_id = conn.execute(
                "INSERT INTO profiles (name) VALUES ('候选人')"
            ).lastrowid
            job_id = conn.execute(
                "INSERT INTO jobs (source_url, title, company) VALUES ('manual://two', '岗位', '公司')"
            ).lastrowid
            conn.execute(
                "INSERT INTO applications (job_id, profile_id) VALUES (?, ?)",
                (job_id, profile_id),
            )
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO applications (job_id, profile_id) VALUES (?, ?)",
                    (job_id, profile_id),
                )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_tool_refactor_schema.py' -v
```

Expected: failures because `jobs.updated_at`, `jobs.triage_updated_at`, `match_results.analysis_version`, `match_results.updated_at`, and the unique indexes do not exist.

- [ ] **Step 3: Add the additive migration**

In `backend/app/db.py`, add these calls beside the existing `ensure_column` calls:

```python
ensure_column("jobs", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP")
ensure_column("jobs", "triage_updated_at", "TEXT")
ensure_column("match_results", "analysis_version", "TEXT NOT NULL DEFAULT 'job-match-v1'")
ensure_column("match_results", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP")
```

Then add the migration and indexes before the existing non-unique indexes:

```python
conn.execute(
    "UPDATE match_results SET analysis_version = 'job-match-v1' WHERE analysis_version = ''"
)
conn.execute(
    """
    DELETE FROM match_results
    WHERE id NOT IN (
        SELECT MAX(id)
        FROM match_results
        GROUP BY job_id, profile_id, analysis_version
    )
    """
)

application_conflicts = conn.execute(
    """
    SELECT job_id, profile_id, COUNT(*) AS count
    FROM applications
    GROUP BY job_id, profile_id
    HAVING COUNT(*) > 1
    """
).fetchall()
if application_conflicts:
    identifiers = ", ".join(
        f"job={row['job_id']}/profile={row['profile_id']}"
        for row in application_conflicts
    )
    raise RuntimeError(
        "检测到重复求职记录，无法安全升级数据库：" + identifiers
    )

conn.execute(
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_match_current_version
    ON match_results(job_id, profile_id, analysis_version)
    """
)
conn.execute(
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_application_job_profile
    ON applications(job_id, profile_id)
    """
)
```

- [ ] **Step 4: Run schema and full backend tests**

Run:

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_tool_refactor_schema.py' -v
.venv/bin/python -m unittest discover -s tests -v
```

Expected: schema tests pass and the existing backend suite remains green.

- [ ] **Step 5: Commit the schema migration**

```bash
git add backend/app/db.py backend/tests/test_tool_refactor_schema.py
git commit -m "feat(db): add tool-domain data constraints"
```

---

### Task 2: Build authoritative local-job query service

**Files:**
- Modify: `backend/app/domain/jobs.py`
- Modify: `backend/app/repositories/jobs.py`
- Create: `backend/app/services/job_query.py`
- Modify: `backend/app/services/__init__.py`
- Create: `backend/tests/test_job_query_service.py`

- [ ] **Step 1: Write failing query-service tests**

Create `backend/tests/test_job_query_service.py` with tests for exact ID lookup, conversation-first search, multiple matches, and global scope:

```python
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.db import connect, init_db
from app.services.job_query import JobQueryService


class JobQueryServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        init_db(self.db_path)
        with connect(self.db_path) as conn:
            self.conversation_id = conn.execute(
                "INSERT INTO conversations (title) VALUES ('岗位分析')"
            ).lastrowid
            self.shanghai_id = conn.execute(
                """
                INSERT INTO jobs (source_url, title, company, city, salary_text)
                VALUES ('manual://shanghai', 'Agent 工程师', '示例科技', '上海', '25-35K')
                """
            ).lastrowid
            self.hangzhou_id = conn.execute(
                """
                INSERT INTO jobs (source_url, title, company, city, salary_text)
                VALUES ('manual://hangzhou', 'Agent 工程师', '示例科技', '杭州', '20-30K')
                """
            ).lastrowid
            conn.execute(
                "INSERT INTO conversation_jobs (conversation_id, job_id) VALUES (?, ?)",
                (self.conversation_id, self.shanghai_id),
            )
        self.service = JobQueryService(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_get_job_uses_stable_id(self) -> None:
        job = self.service.get_job(self.shanghai_id)
        self.assertEqual(job["city"], "上海")

    def test_current_conversation_scope_prefers_linked_job(self) -> None:
        result = self.service.search_jobs(
            "Agent 工程师 示例科技",
            conversation_id=self.conversation_id,
            scope="current_conversation",
            limit=5,
        )
        self.assertFalse(result["requires_selection"])
        self.assertEqual([item["job_id"] for item in result["matches"]], [self.shanghai_id])

    def test_global_scope_reports_ambiguity(self) -> None:
        result = self.service.search_jobs(
            "Agent 工程师 示例科技",
            conversation_id=self.conversation_id,
            scope="all_local_jobs",
            limit=5,
        )
        self.assertTrue(result["requires_selection"])
        self.assertEqual(
            {item["job_id"] for item in result["matches"]},
            {self.shanghai_id, self.hangzhou_id},
        )
```

- [ ] **Step 2: Run the test and verify the service is missing**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_job_query_service.py' -v
```

Expected: import failure for `app.services.job_query`.

- [ ] **Step 3: Add query result models and repository methods**

Append to `backend/app/domain/jobs.py`:

```python
class LocalJobCandidate(BaseModel):
    job_id: int
    title: str
    company: str
    city: str = ""
    district: str = ""
    salary_text: str = ""
    status: str = "new"


class LocalJobSearchResult(BaseModel):
    query: str
    scope: str
    matches: list[LocalJobCandidate] = Field(default_factory=list)
    requires_selection: bool = False
```

Add to `JobRepository` in `backend/app/repositories/jobs.py`:

```python
from ..db import connect, json_dump, row_to_dict, rows_to_dicts

def get(self, job_id: int) -> dict | None:
    with connect(self._db_path) as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return row_to_dict(row)

def list_by_ids(self, job_ids: list[int]) -> list[dict]:
    if not job_ids:
        return []
    placeholders = ",".join("?" for _ in job_ids)
    with connect(self._db_path) as conn:
        rows = conn.execute(
            f"SELECT * FROM jobs WHERE id IN ({placeholders}) ORDER BY id DESC",
            job_ids,
        ).fetchall()
    return rows_to_dicts(rows)

def search(
    self,
    query: str,
    *,
    conversation_id: int | None,
    scope: str,
    limit: int,
) -> list[dict]:
    pattern = f"%{query.strip()}%"
    with connect(self._db_path) as conn:
        if scope == "current_conversation" and conversation_id is not None:
            rows = conn.execute(
                """
                SELECT jobs.*
                FROM jobs
                JOIN conversation_jobs ON conversation_jobs.job_id = jobs.id
                WHERE conversation_jobs.conversation_id = ?
                  AND (jobs.title || ' ' || jobs.company || ' ' || jobs.city) LIKE ?
                ORDER BY jobs.last_seen_at DESC, jobs.id DESC
                LIMIT ?
                """,
                (conversation_id, pattern, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM jobs
                WHERE (title || ' ' || company || ' ' || city) LIKE ?
                ORDER BY last_seen_at DESC, id DESC
                LIMIT ?
                """,
                (pattern, limit),
            ).fetchall()
    return rows_to_dicts(rows)
```

- [ ] **Step 4: Implement `JobQueryService`**

Create `backend/app/services/job_query.py`:

```python
from __future__ import annotations

from pathlib import Path

from ..domain.jobs import LocalJobCandidate, LocalJobSearchResult
from ..repositories.jobs import JobRepository


class JobQueryService:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.repository = JobRepository(db_path)

    def get_job(self, job_id: int) -> dict:
        job = self.repository.get(job_id)
        if job is None:
            raise ValueError("job_not_found")
        return job

    def search_jobs(
        self,
        query: str,
        *,
        conversation_id: int | None,
        scope: str,
        limit: int,
    ) -> dict:
        rows = self.repository.search(
            query,
            conversation_id=conversation_id,
            scope=scope,
            limit=limit,
        )
        result = LocalJobSearchResult(
            query=query,
            scope=scope,
            matches=[
                LocalJobCandidate(
                    job_id=row["id"],
                    title=row["title"],
                    company=row["company"],
                    city=row.get("city", ""),
                    district=row.get("district", ""),
                    salary_text=row.get("salary_text", ""),
                    status=row.get("status", "new"),
                )
                for row in rows
            ],
            requires_selection=len(rows) > 1,
        )
        return result.model_dump(mode="json")

    def list_jobs(
        self,
        *,
        conversation_id: int | None = None,
        job_ids: list[int] | None = None,
    ) -> list[dict]:
        if job_ids:
            return self.repository.list_by_ids(job_ids)
        if conversation_id is None:
            return self.repository.search(
                "",
                conversation_id=None,
                scope="all_local_jobs",
                limit=100,
            )
        return self.repository.search(
            "",
            conversation_id=conversation_id,
            scope="current_conversation",
            limit=100,
        )
```

Export it from `backend/app/services/__init__.py`.

- [ ] **Step 5: Run query and full backend tests**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_job_query_service.py' -v
.venv/bin/python -m unittest discover -s tests -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit the query service**

```bash
git add backend/app/domain/jobs.py backend/app/repositories/jobs.py backend/app/services/job_query.py backend/app/services/__init__.py backend/tests/test_job_query_service.py
git commit -m "feat(jobs): add authoritative local job queries"
```

---

### Task 3: Add stable job search and ID-only detail tools

**Files:**
- Create: `backend/app/tools/search_local_jobs.py`
- Modify: `backend/app/tools/get_job_detail.py`
- Modify: `backend/app/tools/__init__.py`
- Modify: `backend/tests/test_local_tools.py`

- [ ] **Step 1: Add failing direct-tool tests**

In `backend/tests/test_local_tools.py`, import `GetJobDetailTool` and `SearchLocalJobsTool`, then add:

```python
async def test_search_local_jobs_requires_selection_for_multiple_matches(self) -> None:
    with connect(self.db_path) as conn:
        conn.execute(
            """
            INSERT INTO jobs (source_url, title, company, city)
            VALUES ('manual://duplicate', 'AI Agent 工程师', '示例科技', '杭州')
            """
        )
    result = await SearchLocalJobsTool(self.db_path).execute(
        {"query": "AI Agent 工程师 示例科技", "scope": "all_local_jobs", "limit": 5},
        self.context,
    )
    self.assertEqual(result.status, "waiting_approval")
    self.assertEqual(result.error.code, "job_selection_required")

async def test_get_job_detail_accepts_job_id_only(self) -> None:
    result = await GetJobDetailTool(self.db_path).execute(
        {"job_id": self.job_id},
        self.context,
    )
    self.assertTrue(result.ok)
    self.assertEqual(result.data["job"]["id"], self.job_id)
    invalid = await GetJobDetailTool(self.db_path).execute(
        {"query": "示例科技"},
        self.context,
    )
    self.assertFalse(invalid.ok)
    self.assertEqual(invalid.error.code, "invalid_arguments")
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_local_tools.py' -v
```

Expected: missing `SearchLocalJobsTool` and old `get_job_detail` schema failures.

- [ ] **Step 3: Implement `SearchLocalJobsTool`**

Create `backend/app/tools/search_local_jobs.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..services.job_query import JobQueryService
from .base import ToolContext
from .local_data import invalid_arguments


class SearchLocalJobsArguments(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    scope: Literal["current_conversation", "all_local_jobs"] = "current_conversation"
    limit: int = Field(default=5, ge=1, le=10)


class SearchLocalJobsTool:
    definition = ToolDefinition(
        name="search_local_jobs",
        description="在用户已确认录入的本地职位库中查找岗位；多个结果时等待用户选择",
        input_schema=SearchLocalJobsArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.service = JobQueryService(db_path)

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = SearchLocalJobsArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("本地岗位搜索参数不合法", exc)
        result = self.service.search_jobs(
            payload.query,
            conversation_id=context.conversation_id,
            scope=payload.scope,
            limit=payload.limit,
        )
        matches = result["matches"]
        if not matches:
            message = "本地职位库中没有找到对应岗位"
            return ToolResult(
                ok=False,
                status="failed",
                data=result,
                message=message,
                error=ToolError(code="job_not_found", message=message),
            )
        if result["requires_selection"]:
            message = "找到多个相似岗位，请选择一个"
            return ToolResult(
                ok=True,
                status="waiting_approval",
                data=result,
                message=message,
                error=ToolError(code="job_selection_required", message=message, retryable=True),
            )
        return ToolResult(
            ok=True,
            status="done",
            data=result,
            message=f"已找到本地岗位：{matches[0]['title']} · {matches[0]['company']}",
        )
```

- [ ] **Step 4: Make `get_job_detail` ID-only**

Replace `GetJobDetailArguments` and the query branch in `backend/app/tools/get_job_detail.py` with:

```python
class GetJobDetailArguments(BaseModel):
    job_id: int = Field(ge=1)


class GetJobDetailTool:
    definition = ToolDefinition(
        name="get_job_detail",
        description="根据稳定 job_id 读取用户已确认录入本地职位库的岗位详情",
        input_schema=GetJobDetailArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.service = JobQueryService(db_path)

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = GetJobDetailArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("本地岗位查询参数不合法", exc)
        try:
            job = self.service.get_job(payload.job_id)
        except ValueError:
            message = "本地岗位不存在"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="job_not_found", message=message),
            )
        return ToolResult(
            ok=True,
            status="done",
            data={"job": job},
            message=f"已读取本地岗位：{job['title']} · {job['company']}",
        )
```

Export `SearchLocalJobsTool` from `backend/app/tools/__init__.py`.

- [ ] **Step 5: Run direct-tool and full backend tests**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_local_tools.py' -v
.venv/bin/python -m unittest discover -s tests -v
```

Expected: all tests pass after migrating any direct `get_job_detail` test arguments to `job_id`.

- [ ] **Step 6: Commit stable job identity tools**

```bash
git add backend/app/tools/search_local_jobs.py backend/app/tools/get_job_detail.py backend/app/tools/__init__.py backend/tests/test_local_tools.py
git commit -m "feat(agent): add stable local job lookup tools"
```

---

### Task 4: Extract analysis service and current-result upsert

**Files:**
- Create: `backend/app/repositories/matches.py`
- Modify: `backend/app/repositories/__init__.py`
- Create: `backend/app/services/job_analysis.py`
- Modify: `backend/app/services/__init__.py`
- Create: `backend/tests/test_job_analysis_service.py`

- [ ] **Step 1: Write failing service tests**

Create `backend/tests/test_job_analysis_service.py` covering rank order, derived-result upsert, and redacted evidence:

```python
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.db import connect, init_db, json_dump
from app.services.job_analysis import JobAnalysisService


class JobAnalysisServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        init_db(self.db_path)
        with connect(self.db_path) as conn:
            self.profile_id = conn.execute(
                """
                INSERT INTO profiles (
                    name, resume_text, resume_redacted_text, privacy_mode, skills_json
                ) VALUES (?, ?, ?, 'redacted', ?)
                """,
                (
                    "候选人",
                    "Python Agent 工程师，手机号 13800138000",
                    "Python Agent 工程师，手机号 [手机号已隐藏]",
                    json_dump(["Python", "Agent"]),
                ),
            ).lastrowid
            conn.execute(
                """
                INSERT INTO preferences (
                    profile_id, target_roles_json, target_cities_json,
                    salary_min, blocked_keywords_json, blocked_companies_json
                ) VALUES (?, ?, ?, 25000, ?, ?)
                """,
                (
                    self.profile_id,
                    json_dump(["Agent 工程师"]),
                    json_dump(["上海"]),
                    json_dump(["培训"]),
                    json_dump(["屏蔽公司"]),
                ),
            )
            self.good_job_id = conn.execute(
                """
                INSERT INTO jobs (
                    source_url, title, company, city, salary_min, salary_max, description
                ) VALUES ('manual://good', 'Agent 工程师', '正常公司', '上海', 25000, 35000, 'Python Agent 平台开发')
                """
            ).lastrowid
            self.bad_job_id = conn.execute(
                """
                INSERT INTO jobs (
                    source_url, title, company, city, salary_min, salary_max, description
                ) VALUES ('manual://bad', 'Agent 培训工程师', '屏蔽公司', '上海', 10000, 15000, '培训招生')
                """
            ).lastrowid
        self.service = JobAnalysisService(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_rank_local_jobs_uses_authoritative_profile_and_jobs(self) -> None:
        result = self.service.rank_jobs(
            profile_id=self.profile_id,
            job_ids=[self.bad_job_id, self.good_job_id],
            limit=10,
        )
        self.assertEqual(result["matches"][0]["job_id"], self.good_job_id)
        self.assertIn("命中屏蔽公司：屏蔽公司", result["matches"][-1]["risks"])

    def test_match_analysis_upserts_current_version(self) -> None:
        first = self.service.analyze_match(self.profile_id, self.good_job_id)
        second = self.service.analyze_match(self.profile_id, self.good_job_id)
        self.assertEqual(first["analysis_id"], second["analysis_id"])
        with connect(self.db_path) as conn:
            count = conn.execute("SELECT COUNT(*) AS count FROM match_results").fetchone()["count"]
        self.assertEqual(count, 1)

    def test_resume_gap_uses_redacted_resume(self) -> None:
        result = self.service.analyze_resume_gap(self.profile_id, self.good_job_id)
        serialized = json_dump(result)
        self.assertNotIn("13800138000", serialized)
        self.assertIn("[手机号已隐藏]", serialized)
```

- [ ] **Step 2: Run the tests and verify the service is missing**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_job_analysis_service.py' -v
```

Expected: import failure for `JobAnalysisService`.

- [ ] **Step 3: Implement match repository upsert**

Create `backend/app/repositories/matches.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..db import connect, json_dump, row_to_dict


class MatchRepository:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = db_path

    def upsert_current(
        self,
        *,
        job_id: int,
        profile_id: int,
        score: int,
        level: str,
        reasons: list[str],
        risks: list[str],
        suggested_angle: str,
        analysis_version: str,
    ) -> dict[str, Any]:
        with connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO match_results (
                    job_id, profile_id, score, level, reasons_json, risks_json,
                    suggested_angle, analysis_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id, profile_id, analysis_version) DO UPDATE SET
                    score = excluded.score,
                    level = excluded.level,
                    reasons_json = excluded.reasons_json,
                    risks_json = excluded.risks_json,
                    suggested_angle = excluded.suggested_angle,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    job_id,
                    profile_id,
                    score,
                    level,
                    json_dump(reasons),
                    json_dump(risks),
                    suggested_angle,
                    analysis_version,
                ),
            )
            row = conn.execute(
                """
                SELECT * FROM match_results
                WHERE job_id = ? AND profile_id = ? AND analysis_version = ?
                """,
                (job_id, profile_id, analysis_version),
            ).fetchone()
        return row_to_dict(row) or {}
```

- [ ] **Step 4: Implement `JobAnalysisService`**

Create `backend/app/services/job_analysis.py` by moving the deterministic scoring logic from `AnalyzeJobTool` and `RankJobsTool` behind repository-backed methods. Its public methods must have these complete signatures and outputs:

```python
from __future__ import annotations

from pathlib import Path

from ..profile_intelligence import analyze_gap
from ..repositories.jobs import JobRepository
from ..repositories.matches import MatchRepository
from ..tools.local_data import profile_for_agent, resolve_profile


class JobAnalysisService:
    ANALYSIS_VERSION = "job-match-v1"

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = db_path
        self.jobs = JobRepository(db_path)
        self.matches = MatchRepository(db_path)

    def rank_jobs(self, *, profile_id: int, job_ids: list[int], limit: int) -> dict:
        profile, preferences = resolve_profile(profile_id, self.db_path)
        if profile is None:
            raise ValueError("candidate_profile_missing")
        jobs = self.jobs.list_by_ids(job_ids)
        ranked = [self._score_job(job, profile, preferences or {}) for job in jobs]
        ranked.sort(key=lambda item: (-item["score"], item["job_id"]))
        return {
            "analysis_version": self.ANALYSIS_VERSION,
            "matches": ranked[:limit],
        }

    def analyze_match(self, profile_id: int, job_id: int) -> dict:
        profile, preferences = resolve_profile(profile_id, self.db_path)
        job = self.jobs.get(job_id)
        if profile is None:
            raise ValueError("candidate_profile_missing")
        if job is None:
            raise ValueError("job_not_found")
        scored = self._score_job(job, profile, preferences or {})
        row = self.matches.upsert_current(
            job_id=job_id,
            profile_id=profile_id,
            score=scored["score"],
            level=scored["level"],
            reasons=scored["reasons"],
            risks=scored["risks"],
            suggested_angle=scored["suggested_angle"],
            analysis_version=self.ANALYSIS_VERSION,
        )
        return {
            "analysis_id": row["id"],
            "analysis_version": self.ANALYSIS_VERSION,
            "job_id": job_id,
            "score": row["score"],
            "level": row["level"],
            "reasons": row["reasons"],
            "risks": row["risks"],
            "suggested_angle": row["suggested_angle"],
            "confidence": "high" if job.get("description") else "limited",
        }

    def analyze_resume_gap(self, profile_id: int, job_id: int) -> dict:
        profile, _ = resolve_profile(profile_id, self.db_path)
        job = self.jobs.get(job_id)
        if profile is None:
            raise ValueError("candidate_profile_missing")
        if job is None:
            raise ValueError("job_not_found")
        gap = analyze_gap(job, profile_for_agent(profile))
        return {
            "analysis_version": "resume-gap-v1",
            "job_id": job_id,
            "gap": gap,
        }

    @staticmethod
    def _score_job(job: dict, profile: dict, preferences: dict) -> dict:
        job_text = " ".join(
            str(job.get(key) or "")
            for key in ("title", "description", "industry", "company", "city", "district")
        ).lower()
        raw = job.get("raw") or {}
        job_text = f"{job_text} {' '.join(raw.get('tags', []))}".lower()
        skills = [str(item) for item in profile.get("skills", []) if str(item).strip()]
        roles = [str(item) for item in preferences.get("target_roles", [])]
        cities = [str(item).removesuffix("市") for item in preferences.get("target_cities", [])]
        blocked_keywords = [str(item) for item in preferences.get("blocked_keywords", [])]
        blocked_companies = [str(item) for item in preferences.get("blocked_companies", [])]

        score = 35
        reasons: list[str] = []
        risks: list[str] = []
        matched_skills = [skill for skill in skills if skill.lower() in job_text]
        if matched_skills:
            score += min(30, len(matched_skills) * 8)
            reasons.append(f"技能命中：{'、'.join(matched_skills[:6])}")
        if any(role.lower() in job["title"].lower() for role in roles if role):
            score += 20
            reasons.append("目标岗位方向匹配")
        location = f"{job.get('city', '')}{job.get('district', '')}"
        if any(city and city in location for city in cities):
            score += 10
            reasons.append("工作城市符合偏好")

        salary_min = preferences.get("salary_min")
        job_salary_max = job.get("salary_max")
        if salary_min and job_salary_max is not None:
            if job_salary_max >= salary_min:
                score += 5
                reasons.append("岗位薪资范围覆盖期望下限")
            else:
                score -= 20
                risks.append("岗位薪资上限低于期望下限")

        company = str(job.get("company") or "")
        for blocked in blocked_companies:
            if blocked and blocked.lower() in company.lower():
                score -= 50
                risks.append(f"命中屏蔽公司：{blocked}")
        for blocked in blocked_keywords:
            if blocked and blocked.lower() in job_text:
                score -= 25
                risks.append(f"命中屏蔽关键词：{blocked}")
        for keyword, risk in (
            ("外包", "疑似外包岗位"),
            ("培训", "疑似培训或招生岗位"),
            ("押金", "岗位内容涉及押金"),
            ("贷款", "岗位内容涉及贷款"),
        ):
            if keyword in job_text and risk not in risks:
                score -= 15
                risks.append(risk)

        if not job.get("description"):
            risks.append("尚未读取完整岗位描述，分析可信度有限")
        if not reasons:
            reasons.append("当前画像与岗位没有明显匹配证据")
        score = max(0, min(100, score))
        level = "recommended" if score >= 75 else "consider" if score >= 55 else "skip"
        suggested_angle = (
            f"优先突出与岗位相关的技能：{'、'.join(matched_skills[:3])}"
            if matched_skills
            else "优先说明与岗位职责最接近的项目经历，并询问团队当前核心需求"
        )
        return {
            "job_id": job["id"],
            "title": job["title"],
            "company": job["company"],
            "score": score,
            "level": level,
            "reasons": reasons,
            "risks": risks,
            "suggested_angle": suggested_angle,
        }
```

Do not accept model-supplied jobs, keywords, cities, or blocked lists.

Export `MatchRepository` and `JobAnalysisService` from their package `__init__.py` files.

- [ ] **Step 5: Run service and full backend tests**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_job_analysis_service.py' -v
.venv/bin/python -m unittest discover -s tests -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit the analysis service**

```bash
git add backend/app/repositories/matches.py backend/app/repositories/__init__.py backend/app/services/job_analysis.py backend/app/services/__init__.py backend/tests/test_job_analysis_service.py
git commit -m "feat(analysis): add authoritative job analysis service"
```

---

### Task 5: Add new analysis tool adapters

**Files:**
- Create: `backend/app/tools/rank_local_jobs.py`
- Create: `backend/app/tools/analyze_job_match.py`
- Modify: `backend/app/tools/analyze_resume_gap.py`
- Modify: `backend/app/tools/base.py`
- Modify: `backend/app/tools/__init__.py`
- Modify: `backend/tests/test_local_tools.py`

- [ ] **Step 1: Write failing new-tool tests**

Add imports and tests in `backend/tests/test_local_tools.py`:

```python
async def test_rank_local_jobs_reads_database_by_id(self) -> None:
    result = await RankLocalJobsTool(self.db_path).execute(
        {"job_ids": [self.job_id], "scope": "all_local_jobs", "limit": 10},
        ToolContext(platform_name="manual", active_profile_id=self.profile_id),
    )
    self.assertTrue(result.ok)
    self.assertEqual(result.data["matches"][0]["job_id"], self.job_id)

async def test_analyze_job_match_uses_active_profile(self) -> None:
    result = await AnalyzeJobMatchTool(self.db_path).execute(
        {"job_id": self.job_id},
        ToolContext(platform_name="manual", active_profile_id=self.profile_id),
    )
    self.assertTrue(result.ok)
    self.assertEqual(result.data["job_id"], self.job_id)

async def test_resume_gap_uses_job_id_and_active_profile(self) -> None:
    result = await AnalyzeResumeGapTool(self.db_path).execute(
        {"job_id": self.job_id},
        ToolContext(platform_name="manual", active_profile_id=self.profile_id),
    )
    self.assertTrue(result.ok)
    self.assertEqual(result.data["job_id"], self.job_id)
```

- [ ] **Step 2: Run tests and verify missing classes/contracts**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_local_tools.py' -v
```

Expected: imports or new argument contracts fail.

- [ ] **Step 3: Implement `RankLocalJobsTool`**

Before adding the adapters, add the system-owned field to `ToolContext`:

```python
class ToolContext(BaseModel):
    platform_name: str
    conversation_id: int | None = None
    task_id: int | None = None
    active_profile_id: int | None = None
```

Create `backend/app/tools/rank_local_jobs.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..services.job_analysis import JobAnalysisService
from ..services.job_query import JobQueryService
from .base import ToolContext
from .local_data import invalid_arguments


class RankLocalJobsArguments(BaseModel):
    scope: Literal["current_conversation", "all_local_jobs"] = "current_conversation"
    job_ids: list[int] = Field(default_factory=list, max_length=100)
    limit: int = Field(default=10, ge=1, le=20)


class RankLocalJobsTool:
    definition = ToolDefinition(
        name="rank_local_jobs",
        description="读取当前画像和本地职位库，对多个岗位执行确定性初步排序",
        input_schema=RankLocalJobsArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = db_path
        self.query_service = JobQueryService(db_path)
        self.analysis_service = JobAnalysisService(db_path)

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = RankLocalJobsArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("岗位排序参数不合法", exc)
        profile_id = context.active_profile_id
        if profile_id is None:
            message = "尚未配置活动候选人画像"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="candidate_profile_missing", message=message),
            )
        job_ids = payload.job_ids
        if not job_ids:
            jobs = self.query_service.list_jobs(
                conversation_id=(
                    context.conversation_id
                    if payload.scope == "current_conversation"
                    else None
                )
            )
            job_ids = [job["id"] for job in jobs]
        result = self.analysis_service.rank_jobs(
            profile_id=profile_id,
            job_ids=job_ids,
            limit=payload.limit,
        )
        return ToolResult(
            ok=True,
            status="done",
            data=result,
            message=f"已排序 {len(result['matches'])} 个本地岗位",
        )
```

- [ ] **Step 4: Implement `AnalyzeJobMatchTool` and migrate gap adapter**

`AnalyzeJobMatchArguments` and `AnalyzeResumeGapArguments` both contain only:

```python
job_id: int = Field(ge=1)
```

Create `backend/app/tools/analyze_job_match.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..services.job_analysis import JobAnalysisService
from .base import ToolContext
from .local_data import invalid_arguments


class AnalyzeJobMatchArguments(BaseModel):
    job_id: int = Field(ge=1)


class AnalyzeJobMatchTool:
    definition = ToolDefinition(
        name="analyze_job_match",
        description="使用当前活动画像和本地岗位事实执行综合匹配分析，并保存当前版本派生结果",
        input_schema=AnalyzeJobMatchArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.service = JobAnalysisService(db_path)

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = AnalyzeJobMatchArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("岗位匹配分析参数不合法", exc)
        if context.active_profile_id is None:
            message = "尚未配置活动候选人画像"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="candidate_profile_missing", message=message),
            )
        try:
            result = self.service.analyze_match(context.active_profile_id, payload.job_id)
        except ValueError as exc:
            code = str(exc)
            message = "本地岗位不存在" if code == "job_not_found" else "尚未配置活动候选人画像"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code=code, message=message),
            )
        return ToolResult(
            ok=True,
            status="done",
            data=result,
            message=f"已完成岗位匹配分析，匹配分 {result['score']}",
        )
```

Replace `backend/app/tools/analyze_resume_gap.py` with the same validation/error structure and this service call:

```python
result = self.service.analyze_resume_gap(context.active_profile_id, payload.job_id)
return ToolResult(
    ok=True,
    status="done",
    data=result,
    message="已完成简历与岗位差距分析",
)
```

The gap adapter imports `JobAnalysisService`, owns no SQL, and returns `candidate_profile_missing` or `job_not_found` using the same mapping as `AnalyzeJobMatchTool`.

- [ ] **Step 5: Run tests and commit**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_local_tools.py' -v
.venv/bin/python -m unittest discover -s tests -v
cd ..
git add backend/app/tools/rank_local_jobs.py backend/app/tools/analyze_job_match.py backend/app/tools/analyze_resume_gap.py backend/app/tools/base.py backend/app/tools/__init__.py backend/tests/test_local_tools.py
git commit -m "feat(agent): add domain-backed analysis tools"
```

Expected: all backend tests pass before commit.

---

### Task 6: Replace knowledge search with citation-shaped evidence search

**Files:**
- Modify: `backend/app/knowledge.py`
- Create: `backend/app/services/evidence.py`
- Modify: `backend/app/services/__init__.py`
- Create: `backend/app/tools/search_local_evidence.py`
- Modify: `backend/app/tools/search_local_knowledge.py`
- Modify: `backend/app/tools/__init__.py`
- Create: `backend/tests/test_evidence_service.py`

- [ ] **Step 1: Write failing evidence tests**

Create `backend/tests/test_evidence_service.py`:

```python
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.db import init_db
from app.knowledge import index_document
from app.services.evidence import EvidenceSearchService


class EvidenceSearchServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        init_db(self.db_path)
        index_document(
            "resume",
            1,
            "候选人简历",
            "负责设计 Agent 工具调用和 LangGraph 工作流。",
            db_path=self.db_path,
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_returns_citation_shape_and_vector_mode(self) -> None:
        result = EvidenceSearchService(self.db_path).search(
            query="Agent 工作流",
            source_types=["resume"],
            conversation_id=None,
            job_ids=[],
            limit=5,
        )
        self.assertEqual(result["retrieval_mode"], "local_vector")
        self.assertEqual(result["results"][0]["source_type"], "resume")
        self.assertIn("excerpt", result["results"][0])

    def test_reports_text_fallback(self) -> None:
        with patch("app.knowledge._load_vec", side_effect=RuntimeError("disabled")):
            result = EvidenceSearchService(self.db_path).search(
                query="Agent",
                source_types=["resume"],
                conversation_id=None,
                job_ids=[],
                limit=5,
            )
        self.assertEqual(result["retrieval_mode"], "text_fallback")
```

- [ ] **Step 2: Run and verify failure**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_evidence_service.py' -v
```

Expected: missing `EvidenceSearchService` and current search does not report retrieval mode.

- [ ] **Step 3: Return retrieval mode from knowledge search**

Replace `search_knowledge` in `backend/app/knowledge.py` with:

```python
def search_knowledge(
    query: str,
    source_types: list[str] | None = None,
    limit: int = 5,
    db_path: str | Path | None = None,
) -> tuple[list[dict[str, Any]], str]:
    if not query.strip():
        return [], "local_vector"
    mode = "local_vector"
    with connect(db_path) as conn:
        try:
            _load_vec(conn)
            candidates = conn.execute(
                """
                SELECT chunks.*, v.distance
                FROM vec_knowledge v JOIN knowledge_chunks chunks ON chunks.id = v.rowid
                WHERE v.embedding MATCH ? AND k = ?
                ORDER BY v.distance
                """,
                (_serialize(_embed(query)), max(limit * 4, 12)),
            ).fetchall()
        except Exception:
            mode = "text_fallback"
            candidates = conn.execute(
                "SELECT *, 1.0 AS distance FROM knowledge_chunks WHERE content LIKE ? LIMIT ?",
                (f"%{query.strip()}%", max(limit * 4, 12)),
            ).fetchall()
    allowed = set(source_types or [])
    rows = [
        row_to_dict(row)
        for row in candidates
        if not allowed or row["source_type"] in allowed
    ]
    results = [
        {
            **row,
            "similarity": round(max(0.0, 1.0 - float(row.pop("distance", 1.0))), 4),
        }
        for row in rows[:limit]
    ]
    return results, mode
```

Update the existing knowledge test to unpack `(results, mode)` and assert `mode == "local_vector"`.

Until the old adapter is retired in Task 10, change `SearchLocalKnowledgeTool.execute` to:

```python
results, mode = search_knowledge(
    payload.query,
    payload.source_types,
    payload.limit,
    self._db_path,
)
return ToolResult(
    ok=True,
    status="done",
    data={"query": payload.query, "retrieval_mode": mode, "results": results},
    message=f"本地找到 {len(results)} 条相关证据",
)
```

- [ ] **Step 4: Implement service and tool**

Create `backend/app/services/evidence.py`:

```python
class EvidenceSearchService:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = db_path

    def search(
        self,
        *,
        query: str,
        source_types: list[str],
        conversation_id: int | None,
        job_ids: list[int],
        limit: int,
    ) -> dict:
        results, mode = search_knowledge(
            query,
            source_types,
            max(limit * 3, limit),
            self.db_path,
        )
        allowed_job_ids = {str(job_id) for job_id in job_ids}
        filtered = [
            item for item in results
            if item["source_type"] != "job"
            or not allowed_job_ids
            or str(item["source_id"]) in allowed_job_ids
        ][:limit]
        return {
            "query": query,
            "retrieval_mode": mode,
            "results": [
                {
                    "source_type": item["source_type"],
                    "source_id": item["source_id"],
                    "title": item["title"],
                    "excerpt": item["content"],
                    "similarity": item["similarity"],
                }
                for item in filtered
            ],
        }
```

Create `backend/app/tools/search_local_evidence.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..agent_settings import get_agent_settings
from ..domain import ToolDefinition, ToolError, ToolResult
from ..services.evidence import EvidenceSearchService
from .base import ToolContext
from .local_data import invalid_arguments


class SearchLocalEvidenceArguments(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    source_types: list[Literal["resume", "job"]] = Field(default_factory=list)
    job_ids: list[int] = Field(default_factory=list, max_length=100)
    limit: int = Field(default=5, ge=1, le=10)


class SearchLocalEvidenceTool:
    definition = ToolDefinition(
        name="search_local_evidence",
        description="在本机脱敏简历和已确认岗位文本中检索可引用证据片段",
        input_schema=SearchLocalEvidenceArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = db_path
        self.service = EvidenceSearchService(db_path)

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        if not get_agent_settings(self.db_path)["knowledge_memory_enabled"]:
            message = "本地知识记忆已在 Agent 设置中关闭"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="knowledge_memory_disabled", message=message),
            )
        try:
            payload = SearchLocalEvidenceArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("本地证据检索参数不合法", exc)
        result = self.service.search(
            query=payload.query,
            source_types=payload.source_types,
            conversation_id=context.conversation_id,
            job_ids=payload.job_ids,
            limit=payload.limit,
        )
        return ToolResult(
            ok=True,
            status="done",
            data=result,
            message=f"本地找到 {len(result['results'])} 条相关证据",
        )
```

- [ ] **Step 5: Run evidence and full backend tests**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_evidence_service.py' -v
.venv/bin/python -m unittest discover -s tests -p 'test_knowledge.py' -v
.venv/bin/python -m unittest discover -s tests -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit evidence search**

```bash
git add backend/app/knowledge.py backend/app/services/evidence.py backend/app/services/__init__.py backend/app/tools/search_local_evidence.py backend/app/tools/search_local_knowledge.py backend/app/tools/__init__.py backend/tests/test_evidence_service.py backend/tests/test_knowledge.py
git commit -m "feat(knowledge): add citation-shaped local evidence search"
```

---

### Task 7: Add job triage service, API, and tool

**Files:**
- Modify: `backend/app/repositories/jobs.py`
- Create: `backend/app/services/job_triage.py`
- Modify: `backend/app/services/__init__.py`
- Create: `backend/app/tools/set_job_triage.py`
- Modify: `backend/app/tools/__init__.py`
- Modify: `backend/app/api/schemas.py`
- Modify: `backend/app/api/resources.py`
- Create: `backend/tests/test_job_triage_service.py`
- Modify: `backend/tests/test_chat_streaming.py`

- [ ] **Step 1: Write failing service and API tests**

Create `backend/tests/test_job_triage_service.py`:

```python
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.db import connect, init_db
from app.repositories.jobs import JobRepository
from app.services.job_triage import JobTriageService


class JobTriageServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        init_db(self.db_path)
        with connect(self.db_path) as conn:
            self.job_id = conn.execute(
                """
                INSERT INTO jobs (source_url, title, company)
                VALUES ('manual://triage', 'Agent 工程师', '示例科技')
                """
            ).lastrowid
        self.repository = JobRepository(self.db_path)
        self.service = JobTriageService(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_shortlist_returns_previous_and_current(self) -> None:
        result = self.service.set_decision(self.job_id, "shortlisted")
        self.assertTrue(result["changed"])
        self.assertEqual(result["previous"]["decision"], "inbox")
        self.assertEqual(result["current"]["decision"], "shortlisted")

    def test_repeating_decision_is_idempotent(self) -> None:
        self.service.set_decision(self.job_id, "shortlisted")
        result = self.service.set_decision(self.job_id, "shortlisted")
        self.assertFalse(result["changed"])

    def test_triage_does_not_change_last_seen_at(self) -> None:
        before = self.repository.get(self.job_id)["last_seen_at"]
        self.service.set_decision(self.job_id, "dismissed")
        after = self.repository.get(self.job_id)["last_seen_at"]
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
```

Add an API test in `backend/tests/test_chat_streaming.py`:

```python
def test_job_triage_endpoint_updates_local_decision(self) -> None:
    with db.connect() as conn:
        job_id = conn.execute(
            """
            INSERT INTO jobs (source_url, title, company)
            VALUES ('manual://triage-api', 'Agent 工程师', '示例科技')
            """
        ).lastrowid
    response = self.client.patch(
        f"/jobs/{job_id}/triage",
        json={"decision": "shortlisted"},
    )
    self.assertEqual(response.status_code, 200)
    self.assertEqual(response.json()["current"]["decision"], "shortlisted")
```

- [ ] **Step 2: Run and verify failures**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_job_triage_service.py' -v
.venv/bin/python -m unittest discover -s tests -p 'test_chat_streaming.py' -v
```

Expected: service and endpoint are missing.

- [ ] **Step 3: Add repository and service implementation**

Add to `JobRepository`:

```python
def set_triage_status(self, job_id: int, stored_status: str) -> tuple[dict, dict]:
    with connect(self._db_path) as conn:
        before = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if before is None:
            raise ValueError("job_not_found")
        if before["status"] != stored_status:
            conn.execute(
                """
                UPDATE jobs
                SET status = ?, triage_updated_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (stored_status, job_id),
            )
        after = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return row_to_dict(before) or {}, row_to_dict(after) or {}
```

Create `backend/app/services/job_triage.py`:

```python
from __future__ import annotations

from pathlib import Path

from ..repositories.jobs import JobRepository


TO_STORAGE = {"inbox": "new", "shortlisted": "shortlisted", "dismissed": "skipped"}
FROM_STORAGE = {value: key for key, value in TO_STORAGE.items()}


class JobTriageService:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.repository = JobRepository(db_path)

    def set_decision(self, job_id: int, decision: str) -> dict:
        if decision not in TO_STORAGE:
            raise ValueError("invalid_arguments")
        before, after = self.repository.set_triage_status(job_id, TO_STORAGE[decision])
        previous = FROM_STORAGE[before["status"]]
        current = FROM_STORAGE[after["status"]]
        return {
            "entity_type": "job",
            "entity_id": job_id,
            "job_id": job_id,
            "changed": previous != current,
            "previous": {"decision": previous},
            "current": {"decision": current},
        }
```

- [ ] **Step 4: Add tool and REST endpoint**

Add `JobTriageIn` to `backend/app/api/schemas.py`:

```python
class JobTriageIn(BaseModel):
    decision: Literal["inbox", "shortlisted", "dismissed"]
```

Add endpoint:

```python
@router.patch("/jobs/{job_id}/triage")
def set_job_triage(job_id: int, payload: JobTriageIn) -> dict[str, Any]:
    try:
        result = JobTriageService().set_decision(job_id, payload.decision)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="岗位不存在") from exc
    result["workflow"] = refresh_workflow_status()
    return result
```

Create `backend/app/tools/set_job_triage.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..services.job_triage import JobTriageService
from .base import ToolContext
from .local_data import invalid_arguments


class SetJobTriageArguments(BaseModel):
    job_id: int = Field(ge=1)
    decision: Literal["inbox", "shortlisted", "dismissed"]


class SetJobTriageTool:
    definition = ToolDefinition(
        name="set_job_triage",
        description="根据用户明确指令，将本地岗位设为待筛选、候选或已跳过",
        input_schema=SetJobTriageArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.service = JobTriageService(db_path)

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = SetJobTriageArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("岗位筛选参数不合法", exc)
        try:
            result = self.service.set_decision(payload.job_id, payload.decision)
        except ValueError:
            message = "本地岗位不存在"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="job_not_found", message=message),
            )
        return ToolResult(
            ok=True,
            status="done",
            data=result,
            message="已更新本地岗位筛选状态" if result["changed"] else "岗位已经处于目标状态",
        )
```

- [ ] **Step 5: Run tests and commit**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_job_triage_service.py' -v
.venv/bin/python -m unittest discover -s tests -p 'test_chat_streaming.py' -v
.venv/bin/python -m unittest discover -s tests -v
cd ..
git add backend/app/repositories/jobs.py backend/app/services/job_triage.py backend/app/services/__init__.py backend/app/tools/set_job_triage.py backend/app/tools/__init__.py backend/app/api/schemas.py backend/app/api/resources.py backend/tests/test_job_triage_service.py backend/tests/test_chat_streaming.py
git commit -m "feat(jobs): add shared job triage operations"
```

---

### Task 8: Unify drafts, queue, and factual progress by job ID

**Files:**
- Create: `backend/app/repositories/applications.py`
- Modify: `backend/app/repositories/__init__.py`
- Create: `backend/app/services/applications.py`
- Modify: `backend/app/services/__init__.py`
- Modify: `backend/app/tools/save_greeting_draft.py`
- Modify: `backend/app/tools/queue_application.py`
- Create: `backend/app/tools/record_application_progress.py`
- Modify: `backend/app/tools/__init__.py`
- Modify: `backend/app/tools/base.py`
- Modify: `backend/app/api/schemas.py`
- Modify: `backend/app/api/resources.py`
- Create: `backend/tests/test_application_service.py`

- [ ] **Step 1: Write failing application service tests**

Create `backend/tests/test_application_service.py`:

```python
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.db import connect, init_db
from app.services.applications import ApplicationService


class ApplicationServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        init_db(self.db_path)
        with connect(self.db_path) as conn:
            self.profile_id = conn.execute(
                "INSERT INTO profiles (name) VALUES ('候选人')"
            ).lastrowid
            self.job_id = conn.execute(
                """
                INSERT INTO jobs (source_url, title, company)
                VALUES ('manual://application', 'Agent 工程师', '示例科技')
                """
            ).lastrowid
        self.service = ApplicationService(self.db_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_queue_is_unique_by_job_and_profile(self) -> None:
        first = self.service.queue_application(self.profile_id, self.job_id, "")
        second = self.service.queue_application(self.profile_id, self.job_id, "")
        self.assertEqual(first["id"], second["id"])

    def test_record_progress_resolves_by_job_id(self) -> None:
        queued = self.service.queue_application(self.profile_id, self.job_id, "")
        result = self.service.record_progress(
            self.profile_id,
            self.job_id,
            "applied",
            "用户确认已投递",
        )
        self.assertEqual(result["entity_id"], queued["id"])
        self.assertEqual(result["current"]["status"], "applied")
        self.assertIsNotNone(result["application"]["applied_at"])

    def test_explicit_correction_preserves_fact_timestamps(self) -> None:
        self.service.queue_application(self.profile_id, self.job_id, "")
        applied = self.service.record_progress(self.profile_id, self.job_id, "applied", None)
        corrected = self.service.record_progress(
            self.profile_id,
            self.job_id,
            "queued",
            "纠正记录",
        )
        self.assertEqual(corrected["current"]["status"], "queued")
        self.assertEqual(
            corrected["application"]["applied_at"],
            applied["application"]["applied_at"],
        )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run and verify missing service**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_application_service.py' -v
```

Expected: import failure for `ApplicationService`.

- [ ] **Step 3: Implement repository and service**

Create `backend/app/repositories/applications.py`:

```python
from __future__ import annotations

from pathlib import Path

from ..db import connect, row_to_dict


class ApplicationRepository:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = db_path

    def get_by_job_profile(self, job_id: int, profile_id: int) -> dict | None:
        with connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM applications WHERE job_id = ? AND profile_id = ?",
                (job_id, profile_id),
            ).fetchone()
        return row_to_dict(row)

    def create(self, job_id: int, profile_id: int, status: str, notes: str) -> dict:
        with connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO applications (job_id, profile_id, status, notes)
                VALUES (?, ?, ?, ?)
                """,
                (job_id, profile_id, status, notes),
            )
            row = conn.execute(
                "SELECT * FROM applications WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
        return row_to_dict(row) or {}

    def update_status(
        self,
        application_id: int,
        *,
        status: str,
        notes: str | None,
        set_applied_at: bool,
        set_contact_at: bool,
    ) -> dict:
        applied_expr = "COALESCE(applied_at, CURRENT_TIMESTAMP)" if set_applied_at else "applied_at"
        contact_expr = "CURRENT_TIMESTAMP" if set_contact_at else "last_contact_at"
        with connect(self.db_path) as conn:
            conn.execute(
                f"""
                UPDATE applications
                SET status = ?, notes = COALESCE(?, notes),
                    applied_at = {applied_expr},
                    last_contact_at = {contact_expr},
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (status, notes, application_id),
            )
            row = conn.execute(
                "SELECT * FROM applications WHERE id = ?",
                (application_id,),
            ).fetchone()
        return row_to_dict(row) or {}

    def save_draft(
        self,
        job_id: int,
        profile_id: int,
        text: str,
        style: str,
    ) -> dict:
        with connect(self.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO messages (job_id, profile_id, style, generated_text, status)
                VALUES (?, ?, ?, ?, 'draft')
                """,
                (job_id, profile_id, style, text),
            )
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return row_to_dict(row) or {}
```

Create `backend/app/services/applications.py`:

```python
from __future__ import annotations

from pathlib import Path

from ..repositories.applications import ApplicationRepository
from ..repositories.jobs import JobRepository


class ApplicationService:
    STATUSES = {"queued", "applied", "contacted", "interview", "rejected", "no_response"}

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.applications = ApplicationRepository(db_path)
        self.jobs = JobRepository(db_path)

    def _require_job(self, job_id: int) -> dict:
        job = self.jobs.get(job_id)
        if job is None:
            raise ValueError("job_not_found")
        return job

    def save_greeting_draft(
        self,
        profile_id: int,
        job_id: int,
        text: str,
        style: str,
    ) -> dict:
        self._require_job(job_id)
        return self.applications.save_draft(job_id, profile_id, text, style)

    def queue_application(self, profile_id: int, job_id: int, notes: str) -> dict:
        self._require_job(job_id)
        existing = self.applications.get_by_job_profile(job_id, profile_id)
        if existing is not None:
            return existing
        return self.applications.create(job_id, profile_id, "queued", notes)

    def record_progress(
        self,
        profile_id: int,
        job_id: int,
        status: str,
        notes: str | None,
    ) -> dict:
        if status not in self.STATUSES:
            raise ValueError("invalid_arguments")
        self._require_job(job_id)
        before = self.applications.get_by_job_profile(job_id, profile_id)
        if before is None:
            before = self.applications.create(job_id, profile_id, "queued", "")
        after = self.applications.update_status(
            before["id"],
            status=status,
            notes=notes,
            set_applied_at=status == "applied",
            set_contact_at=status in {"contacted", "interview"},
        )
        return {
            "entity_type": "application",
            "entity_id": after["id"],
            "job_id": job_id,
            "changed": before["status"] != after["status"] or (
                notes is not None and notes != before["notes"]
            ),
            "previous": {"status": before["status"]},
            "current": {"status": after["status"]},
            "application": after,
        }
```

- [ ] **Step 4: Migrate tools to `job_id` and active profile**

Add `intent_kind: str = "conversation"` to `ToolContext` before creating the factual-progress adapter.

Use these exact model-visible argument models:

```python
class SaveGreetingDraftArguments(BaseModel):
    job_id: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=500)
    style: Literal["concise", "technical", "project", "enthusiastic"] = "concise"


class QueueApplicationArguments(BaseModel):
    job_id: int = Field(ge=1)
    notes: str = Field(default="", max_length=1000)


class RecordApplicationProgressArguments(BaseModel):
    job_id: int = Field(ge=1)
    status: Literal["queued", "applied", "contacted", "interview", "rejected", "no_response"]
    notes: str | None = Field(default=None, max_length=1000)
```

Every adapter checks `context.active_profile_id`; when absent it returns:

```python
ToolResult(
    ok=False,
    status="failed",
    message="尚未配置活动候选人画像",
    error=ToolError(
        code="candidate_profile_missing",
        message="尚未配置活动候选人画像",
    ),
)
```

The save adapter calls:

```python
draft = self.service.save_greeting_draft(
    context.active_profile_id,
    payload.job_id,
    payload.text,
    payload.style,
)
return ToolResult(
    ok=True,
    status="done",
    data={"draft": draft, "job_id": payload.job_id},
    message="已保存本地沟通草稿（尚未发送）",
)
```

The queue adapter calls:

```python
application = self.service.queue_application(
    context.active_profile_id,
    payload.job_id,
    payload.notes,
)
return ToolResult(
    ok=True,
    status="done",
    data={"application": application, "job_id": payload.job_id},
    message="已加入本地待投递记录（尚未执行外部操作）",
)
```

Create `backend/app/tools/record_application_progress.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..domain import ToolDefinition, ToolError, ToolResult
from ..services.applications import ApplicationService
from .base import ToolContext
from .local_data import invalid_arguments


class RecordApplicationProgressArguments(BaseModel):
    job_id: int = Field(ge=1)
    status: Literal["queued", "applied", "contacted", "interview", "rejected", "no_response"]
    notes: str | None = Field(default=None, max_length=1000)


class RecordApplicationProgressTool:
    definition = ToolDefinition(
        name="record_application_progress",
        description="根据用户明确陈述的事实，按 job_id 更新本地求职进展；不执行外部操作",
        input_schema=RecordApplicationProgressArguments.model_json_schema(),
    )

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.service = ApplicationService(db_path)

    async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            payload = RecordApplicationProgressArguments.model_validate(arguments)
        except ValidationError as exc:
            return invalid_arguments("求职进展参数不合法", exc)
        if context.intent_kind != "application_progress":
            message = "只有用户明确陈述真实进展时才能更新本地求职记录"
            return ToolResult(
                ok=False,
                status="blocked",
                message=message,
                error=ToolError(code="user_fact_required", message=message),
            )
        if context.active_profile_id is None:
            message = "尚未配置活动候选人画像"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code="candidate_profile_missing", message=message),
            )
        try:
            result = self.service.record_progress(
                context.active_profile_id,
                payload.job_id,
                payload.status,
                payload.notes,
            )
        except ValueError as exc:
            code = str(exc)
            message = "本地岗位不存在" if code == "job_not_found" else "求职进展参数不合法"
            return ToolResult(
                ok=False,
                status="failed",
                message=message,
                error=ToolError(code=code, message=message),
            )
        return ToolResult(
            ok=True,
            status="done",
            data=result,
            message=f"已将本地求职进展更新为 {payload.status}",
        )
```

`RecordApplicationProgressTool` returns `user_fact_required` only when the route/runtime did not mark the original request as a factual-progress intent; do not infer status from job or attachment content.

- [ ] **Step 5: Add REST endpoints**

Add schemas:

```python
class QueueApplicationIn(BaseModel):
    notes: str = Field(default="", max_length=1000)


class ApplicationProgressIn(BaseModel):
    status: Literal["queued", "applied", "contacted", "interview", "rejected", "no_response"]
    notes: str | None = Field(default=None, max_length=1000)
```

Add endpoints keyed by `job_id`:

```python
@router.post("/jobs/{job_id}/application")
def queue_job_application(job_id: int, payload: QueueApplicationIn) -> dict[str, Any]:
    bundle = profile_service.get_candidate_profile()
    profile = bundle["profile"]
    if profile is None:
        raise HTTPException(status_code=409, detail="尚未配置候选人画像")
    try:
        application = ApplicationService().queue_application(
            profile["id"],
            job_id,
            payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="岗位不存在") from exc
    return {"application": application, "workflow": refresh_workflow_status()}

@router.patch("/jobs/{job_id}/application")
def record_job_application_progress(job_id: int, payload: ApplicationProgressIn) -> dict[str, Any]:
    bundle = profile_service.get_candidate_profile()
    profile = bundle["profile"]
    if profile is None:
        raise HTTPException(status_code=409, detail="尚未配置候选人画像")
    try:
        result = ApplicationService().record_progress(
            profile["id"],
            job_id,
            payload.status,
            payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="岗位不存在") from exc
    result["workflow"] = refresh_workflow_status()
    return result
```

Both resolve the active profile through `ProfileService` and call `ApplicationService`.

- [ ] **Step 6: Run tests and commit**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_application_service.py' -v
.venv/bin/python -m unittest discover -s tests -p 'test_local_tools.py' -v
.venv/bin/python -m unittest discover -s tests -p 'test_chat_streaming.py' -v
.venv/bin/python -m unittest discover -s tests -v
cd ..
git add backend/app/repositories/applications.py backend/app/repositories/__init__.py backend/app/services/applications.py backend/app/services/__init__.py backend/app/tools/save_greeting_draft.py backend/app/tools/queue_application.py backend/app/tools/record_application_progress.py backend/app/tools/base.py backend/app/tools/__init__.py backend/app/api/schemas.py backend/app/api/resources.py backend/tests/test_application_service.py backend/tests/test_local_tools.py backend/tests/test_chat_streaming.py
git commit -m "feat(applications): use job-based local progress operations"
```

---

### Task 9: Expand ToolContext and replace routing capability matrix

**Files:**
- Modify: `backend/app/domain/agent.py`
- Modify: `backend/app/tools/base.py`
- Modify: `backend/app/agent/runtime.py`
- Modify: `backend/app/agent/orchestration.py`
- Create: `backend/tests/test_agent_routing_matrix.py`
- Modify: `backend/tests/test_agent_runtime.py`

- [ ] **Step 1: Write the routing matrix tests**

Create table-driven tests in `backend/tests/test_agent_routing_matrix.py`:

```python
READ_TOOLS = {
    "request_manual_job_import",
    "search_local_jobs",
    "get_candidate_context",
    "get_job_detail",
    "rank_local_jobs",
    "analyze_job_match",
    "analyze_resume_gap",
    "search_local_evidence",
    "set_job_triage",
    "save_greeting_draft",
    "queue_application",
    "record_application_progress",
}

CASES = [
    ("比较本地岗位并按优先级排序", "job_compare", {"rank_local_jobs"}),
    ("从简历中找出证明我有 Agent 经验的证据", "evidence_search", {"search_local_evidence"}),
    ("把这个岗位加入候选清单", "job_triage", {"search_local_jobs", "set_job_triage"}),
    ("我已经投递这个岗位，请记录", "application_progress", {"search_local_jobs", "record_application_progress"}),
    ("为这个岗位准备并保存沟通话术", "greeting_draft", {"search_local_jobs", "save_greeting_draft"}),
]

NEGATIVE_CASES = [
    "先不要加入候选",
    "我只是想知道怎么加入候选",
    "如果合适以后再记录已投递",
]

class AgentRoutingMatrixTest(unittest.TestCase):
    def test_positive_intents(self) -> None:
        for text, kind, expected in CASES:
            with self.subTest(text=text):
                route = route_task(text, READ_TOOLS)
                self.assertEqual(route.kind, kind)
                self.assertTrue(expected.issubset(set(route.allowed_tools)))

    def test_negated_or_discussion_requests_do_not_open_write_tools(self) -> None:
        write_tools = {
            "set_job_triage",
            "save_greeting_draft",
            "queue_application",
            "record_application_progress",
        }
        for text in NEGATIVE_CASES:
            with self.subTest(text=text):
                route = route_task(text, READ_TOOLS)
                self.assertFalse(write_tools.intersection(route.allowed_tools))
```

- [ ] **Step 2: Run and verify failures**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_agent_routing_matrix.py' -v
```

Expected: current route kinds/tools do not match.

- [ ] **Step 3: Expand context and risk types**

Extend the `ToolContext` introduced in Task 5 to:

```python
class ToolContext(BaseModel):
    platform_name: str = "manual"
    conversation_id: int | None = None
    task_id: int | None = None
    active_profile_id: int | None = None
    tool_call_id: str | None = None
    intent_kind: str = "conversation"
```

Change `AgentPlanStep.risk` to:

```python
Literal[
    "read_only",
    "derived_analysis",
    "reversible_user_write",
    "factual_record_write",
    "waiting_user",
]
```

In `AgentRuntime.run`, resolve the active profile once after routing and before planning:

```python
from ..tools.local_data import resolve_profile

active_profile, _ = resolve_profile(None)
active_profile_id = active_profile["id"] if active_profile is not None else None
```

Then construct this context for every tool call:

```python
ToolContext(
    platform_name=selected_platform,
    conversation_id=conversation_id,
    task_id=task_id,
    active_profile_id=active_profile_id,
    tool_call_id=tool_call.id,
    intent_kind=route.kind,
)
```

- [ ] **Step 4: Replace route definitions with intent capabilities**

Define the new `TOOL_POLICIES` risks exactly as listed in the approved design, update `ROUTE_LABELS` for the eleven route kinds, and replace `route_task` with this explicit capability routing structure:

```python
def route_task(content: str, available_tools: set[str]) -> TaskRoute:
    text = " ".join(content.lower().split())
    tools: list[str] = []

    def add(*names: str) -> None:
        for name in names:
            if name in available_tools and name not in tools:
                tools.append(name)

    negated_write = any(
        phrase in text
        for phrase in (
            "不要加入",
            "先不要",
            "不用保存",
            "不要保存",
            "只是想知道",
            "怎么加入",
            "如果合适",
            "以后再记录",
        )
    )
    mentions_job = any(word in text for word in ("岗位", "职位", "jd", "公司", "薪资"))
    asks_import = any(word in text for word in ("找岗位", "找工作", "搜索岗位", "采集岗位"))
    asks_compare = any(word in text for word in ("比较", "排序", "优先级", "最值得投"))
    asks_gap = any(word in text for word in ("差距", "缺口", "欠缺", "改进简历"))
    asks_evidence = any(word in text for word in ("找出", "查找", "证据", "证明", "依据")) and any(
        word in text for word in ("简历", "经历", "项目", "岗位")
    )
    asks_analysis = any(word in text for word in ("分析", "匹配", "适合", "评估"))
    asks_triage = any(word in text for word in ("收藏", "候选", "跳过", "不考虑", "恢复待筛选"))
    asks_greeting_save = "保存" in text and any(
        word in text for word in ("话术", "沟通草稿", "招呼语")
    )
    asks_queue = any(word in text for word in ("加入待投", "加入队列", "待投递队列"))
    states_fact = any(
        word in text
        for word in ("已经", "已投递", "已沟通", "约面", "面试", "被拒", "无回复")
    )
    asks_record = any(word in text for word in ("记录", "更新", "标记"))

    if not negated_write and states_fact and asks_record:
        kind = "application_progress"
        add("search_local_jobs", "record_application_progress")
    elif not negated_write and asks_queue:
        kind = "application_queue"
        add("search_local_jobs", "queue_application")
    elif not negated_write and asks_greeting_save:
        kind = "greeting_draft"
        add("search_local_jobs", "save_greeting_draft")
    elif not negated_write and asks_triage:
        kind = "job_triage"
        add("search_local_jobs", "set_job_triage")
    elif asks_import:
        kind = "job_import"
        add("request_manual_job_import")
    elif asks_evidence:
        kind = "evidence_search"
        add("search_local_evidence")
    elif asks_compare:
        kind = "job_compare"
        add("rank_local_jobs", "analyze_job_match")
    elif asks_gap:
        kind = "resume_gap_analysis"
        add("search_local_jobs", "analyze_resume_gap")
    elif mentions_job and asks_analysis:
        kind = "job_analysis"
        add("search_local_jobs", "analyze_job_match")
    elif mentions_job:
        kind = "job_lookup"
        add("search_local_jobs", "get_job_detail")
    else:
        kind = "conversation"

    return TaskRoute(kind=kind, needs_plan=bool(tools), allowed_tools=tuple(tools))
```

If a negative phrase suppresses a write branch, the remaining text may still route to a read-only lookup or conversation, but it must not expose any of the four write tools.

- [ ] **Step 5: Add runtime context assertions**

Extend `backend/tests/test_agent_runtime.py` with a fake tool that captures context and assert:

```python
self.assertEqual(tool.context.conversation_id, 7)
self.assertEqual(tool.context.task_id, 9)
self.assertEqual(tool.context.active_profile_id, profile_id)
self.assertEqual(tool.context.tool_call_id, "call-1")
self.assertEqual(tool.context.intent_kind, "job_analysis")
```

- [ ] **Step 6: Run routing/runtime/full backend tests and commit**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_agent_routing_matrix.py' -v
.venv/bin/python -m unittest discover -s tests -p 'test_agent_runtime.py' -v
.venv/bin/python -m unittest discover -s tests -v
cd ..
git add backend/app/domain/agent.py backend/app/tools/base.py backend/app/agent/runtime.py backend/app/agent/orchestration.py backend/tests/test_agent_routing_matrix.py backend/tests/test_agent_runtime.py
git commit -m "refactor(agent): route domain tool capabilities"
```

---

### Task 10: Register only replacement tools and update model guidance

**Files:**
- Modify: `backend/app/agent/bootstrap.py`
- Modify: `backend/app/tools/__init__.py`
- Modify: `backend/app/tools/get_candidate_context.py`
- Modify: `backend/app/models/openai_compatible.py`
- Create: `backend/tests/test_agent_bootstrap.py`
- Delete after tests migrate: `backend/app/tools/rank_jobs.py`
- Delete after tests migrate: `backend/app/tools/analyze_job.py`
- Delete after tests migrate: `backend/app/tools/search_local_knowledge.py`
- Delete after tests migrate: `backend/app/tools/update_job_status.py`
- Delete after tests migrate: `backend/app/tools/update_application_status.py`

- [ ] **Step 1: Write a failing capability inventory test**

Create `backend/tests/test_agent_bootstrap.py`:

```python
from __future__ import annotations

import unittest
from unittest.mock import patch

from app.agent import bootstrap
from app.config import Settings


EXPECTED_TOOLS = {
    "request_manual_job_import",
    "search_local_jobs",
    "get_candidate_context",
    "get_job_detail",
    "rank_local_jobs",
    "analyze_job_match",
    "analyze_resume_gap",
    "search_local_evidence",
    "set_job_triage",
    "save_greeting_draft",
    "queue_application",
    "record_application_progress",
}


class AgentBootstrapTest(unittest.TestCase):
    def tearDown(self) -> None:
        bootstrap._build_components.cache_clear()

    def test_capabilities_expose_only_domain_refactor_tools(self) -> None:
        settings = Settings(openai_api_key="test-key", model_name="test-model")
        with patch.object(bootstrap, "get_settings", return_value=settings):
            bootstrap._build_components.cache_clear()
            capabilities = bootstrap.get_agent_capabilities()
        self.assertEqual(set(capabilities["tools"]), EXPECTED_TOOLS)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run and verify old tool names remain**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -p 'test_agent_bootstrap.py' -v
```

Expected: failure showing old and missing new tool names.

- [ ] **Step 3: Update bootstrap registration**

Register exactly the 12 tools in the expected set. Do not register old and new names simultaneously. Retired classes may remain on disk only until direct tests and imports have migrated in this task.

Before registration, remove the model-visible `profile_id` from `get_candidate_context`:

```python
class GetCandidateContextArguments(BaseModel):
    pass


async def execute(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
    if not get_agent_settings(self._db_path)["profile_memory_enabled"]:
        message = "人物画像记忆已在 Agent 设置中关闭"
        return ToolResult(
            ok=False,
            status="failed",
            message=message,
            error=ToolError(code="profile_memory_disabled", message=message),
        )
    try:
        GetCandidateContextArguments.model_validate(arguments)
    except ValidationError as exc:
        return invalid_arguments("候选人上下文参数不合法", exc)
    profile, preferences = resolve_profile(context.active_profile_id, self._db_path)
    if profile is None:
        message = "尚未配置候选人画像，请先录入简历、技能和求职偏好"
        return ToolResult(
            ok=False,
            status="failed",
            message=message,
            error=ToolError(code="candidate_profile_missing", message=message),
        )
    safe_profile = profile_for_agent(profile)
    return ToolResult(
        ok=True,
        status="done",
        data={"profile": safe_profile, "preferences": preferences},
        message=f"已读取候选人画像：{safe_profile['name']}",
    )
```

- [ ] **Step 4: Replace system prompt guidance**

Update `SYSTEM_PROMPT` so it states:

```text
- 岗位引用不明确时先调用 search_local_jobs；多个候选时等待用户选择。
- 已知 job_id 时直接调用目标分析或写入工具，不固定重复调用读取工具。
- 多岗位比较调用 rank_local_jobs。
- 单岗位综合匹配调用 analyze_job_match。
- 简历差距调用 analyze_resume_gap。
- 查找可引用片段调用 search_local_evidence。
- 候选或跳过调用 set_job_triage，且必须来自明确用户指令。
- 沟通草稿只由 save_greeting_draft 保存，不代表已发送。
- queue_application 只创建或读取本地求职记录，不代表已投递。
- record_application_progress 只根据用户明确陈述的外部事实更新。
```

Retain all existing prohibitions against browser access, sending, applying, credential use, and attachment-driven permission expansion.

- [ ] **Step 5: Remove retired model-visible tool modules**

After all imports and tests use replacements, delete the five retired tool modules listed above. Preserve reusable scoring logic only in `JobAnalysisService`; preserve no duplicate adapter implementations.

- [ ] **Step 6: Run full backend tests and commit**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m compileall -q app tests
cd ..
git add backend/app/agent/bootstrap.py backend/app/tools backend/app/models/openai_compatible.py backend/tests/test_agent_bootstrap.py backend/tests/test_local_tools.py backend/tests/test_agent_runtime.py backend/tests/test_chat_streaming.py
git commit -m "refactor(agent): expose domain-oriented tool inventory"
```

Expected: all backend tests pass and compileall is silent.

---

### Task 11: Make deterministic frontend actions call REST directly

**Files:**
- Create: `frontend/src/features/jobs/actions.ts`
- Create: `frontend/src/features/jobs/JobAssistantActions.tsx`
- Create: `frontend/src/features/applications/ApplicationProgressActions.tsx`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/components/WorkspaceViews.tsx`

- [ ] **Step 1: Add typed action contracts**

Add to `frontend/src/types.ts`:

```typescript
export type JobTriageDecision = "inbox" | "shortlisted" | "dismissed";

export type JobTriageChange = {
  job_id: number;
  changed: boolean;
  previous: { decision: JobTriageDecision };
  current: { decision: JobTriageDecision };
};

export type ApplicationStatus =
  | "queued"
  | "applied"
  | "contacted"
  | "interview"
  | "rejected"
  | "no_response";

// Update the existing Application type to use:
// status: ApplicationStatus;

export type ApplicationChange = {
  entity_id: number;
  job_id: number;
  changed: boolean;
  previous: { status: ApplicationStatus };
  current: { status: ApplicationStatus };
  application: Application;
};

export type QueueApplicationResult = {
  application: Application;
};
```

- [ ] **Step 2: Add deterministic REST helpers**

Create `frontend/src/features/jobs/actions.ts`:

```typescript
import type {
  ApplicationChange,
  ApplicationStatus,
  JobTriageChange,
  JobTriageDecision,
  QueueApplicationResult
} from "../../types";

type FetchJson = <T>(path: string, options?: RequestInit) => Promise<T>;

export function setJobTriage(
  fetchJson: FetchJson,
  jobId: number,
  decision: JobTriageDecision
) {
  return fetchJson<JobTriageChange>(`/jobs/${jobId}/triage`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision })
  });
}

export function queueJobApplication(fetchJson: FetchJson, jobId: number, notes = "") {
  return fetchJson<QueueApplicationResult>(`/jobs/${jobId}/application`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes })
  });
}

export function recordApplicationProgress(
  fetchJson: FetchJson,
  jobId: number,
  status: ApplicationStatus,
  notes?: string
) {
  return fetchJson<ApplicationChange>(`/jobs/${jobId}/application`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, notes })
  });
}
```

- [ ] **Step 3: Extract job action controls**

Create `JobAssistantActions.tsx` with distinct callbacks:

```tsx
type Props = {
  onAnalyze: () => void;
  onGap: () => void;
  onShortlist: () => void;
  onGreeting: () => void;
  busy?: boolean;
};

export function JobAssistantActions(props: Props) {
  return (
    <section className="job-assistant-actions">
      <div><span className="card-kicker">让 Agent 继续</span><h3>从查看到决定</h3></div>
      <div>
        <button className="secondary-button" onClick={props.onAnalyze} disabled={props.busy}>深度分析</button>
        <button className="secondary-button" onClick={props.onGap} disabled={props.busy}>简历差距</button>
        <button className="secondary-button" onClick={props.onShortlist} disabled={props.busy}>加入候选</button>
        <button className="secondary-button" onClick={props.onGreeting} disabled={props.busy}>准备话术</button>
      </div>
    </section>
  );
}
```

Retain the current Lucide icons when moving the JSX; do not merge `onShortlist` into the Agent prompt callback.

- [ ] **Step 4: Change `main.tsx` handlers**

Replace `runJobAction("shortlist")` with a direct handler:

```typescript
async function shortlistSelectedJob() {
  if (!selectedJob) return;
  setRefreshBusy(true);
  setErrorMessage("");
  try {
    const result = await setJobTriage(fetchJson, selectedJob.id, "shortlisted");
    await refreshData(false);
    setNoticeMessage(
      result.changed ? `已将「${selectedJob.title}」加入候选。` : `「${selectedJob.title}」已经在候选清单中。`
    );
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : "更新候选状态失败");
  } finally {
    setRefreshBusy(false);
  }
}
```

Keep Agent prompts only for `analyze`, `gap`, and `greeting`, and include stable ID:

```typescript
const prompts = {
  analyze: `分析本地岗位 ID ${selectedJob.id}「${selectedJob.title} - ${selectedJob.company}」，告诉我匹配理由和风险`,
  gap: `对比我的简历与本地岗位 ID ${selectedJob.id}「${selectedJob.title} - ${selectedJob.company}」，列出已匹配技能、缺口和真实证据`,
  greeting: `为本地岗位 ID ${selectedJob.id}「${selectedJob.title} - ${selectedJob.company}」准备一条真实、简洁的沟通话术并保存为草稿`
};
```

- [ ] **Step 5: Add explicit application progress controls**

Create `frontend/src/features/applications/ApplicationProgressActions.tsx`:

```tsx
import { useState } from "react";
import type { ApplicationStatus } from "../../types";

export function ApplicationProgressActions({
  currentStatus,
  onUpdate,
  busy = false
}: {
  currentStatus: ApplicationStatus;
  onUpdate: (status: ApplicationStatus) => void;
  busy?: boolean;
}) {
  const [status, setStatus] = useState<ApplicationStatus>(currentStatus);
  return (
    <div className="application-progress-actions">
      <label>
        <select
          aria-label="求职进展"
          value={status}
          disabled={busy}
          onChange={(event) => setStatus(event.target.value as ApplicationStatus)}
        >
          <option value="queued">待投递</option>
          <option value="applied">已投递</option>
          <option value="contacted">已沟通</option>
          <option value="interview">面试中</option>
          <option value="rejected">未通过</option>
          <option value="no_response">暂无回复</option>
        </select>
      </label>
      <button disabled={busy || status === currentStatus} onClick={() => onUpdate(status)}>
        更新本地记录
      </button>
    </div>
  );
}
```

Update `ApplicationsView` to accept `onUpdate(jobId, status)` and render this component for each row. In `main.tsx`, implement:

```typescript
async function updateApplicationProgress(jobId: number, status: ApplicationStatus) {
  setRefreshBusy(true);
  setErrorMessage("");
  try {
    await recordApplicationProgress(fetchJson, jobId, status);
    await refreshData(false);
    setNoticeMessage("已更新本地求职进展；BossCopilot 未执行任何外部操作。");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : "更新求职进展失败");
  } finally {
    setRefreshBusy(false);
  }
}
```

- [ ] **Step 6: Build frontend and commit**

```bash
cd frontend
npm run build
cd ..
git add frontend/src/types.ts frontend/src/features frontend/src/main.tsx frontend/src/components/WorkspaceViews.tsx
git commit -m "refactor(frontend): call deterministic job actions directly"
```

Expected: TypeScript and Vite build succeed.

---

### Task 12: Add frontend interaction tests

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/features/jobs/actions.test.ts`
- Create: `frontend/src/features/jobs/JobAssistantActions.test.tsx`
- Create: `frontend/src/features/applications/ApplicationProgressActions.test.tsx`

- [ ] **Step 1: Install and configure the test stack**

Run:

```bash
cd frontend
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Add scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Extend `vite.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173 },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
});
```

Create setup:

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Test REST helper contracts**

In `actions.test.ts`, mock `fetchJson` and assert exact path, method, and JSON body for triage, queue, and progress. Include this queue and progress coverage beside the triage test:

```typescript
it("queues by stable job ID", async () => {
  const fetchJson = vi.fn().mockResolvedValue({ application: { id: 1 } });
  await queueJobApplication(fetchJson, 12, "优先处理");
  expect(fetchJson).toHaveBeenCalledWith("/jobs/12/application", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: "优先处理" })
  });
});

it("records progress by stable job ID", async () => {
  const fetchJson = vi.fn().mockResolvedValue({ current: { status: "applied" } });
  await recordApplicationProgress(fetchJson, 12, "applied", "用户确认已投递");
  expect(fetchJson).toHaveBeenCalledWith("/jobs/12/application", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "applied", notes: "用户确认已投递" })
  });
});
```

```typescript
it("updates triage through the deterministic endpoint", async () => {
  const fetchJson = vi.fn().mockResolvedValue({ changed: true });
  await setJobTriage(fetchJson, 12, "shortlisted");
  expect(fetchJson).toHaveBeenCalledWith("/jobs/12/triage", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "shortlisted" })
  });
});
```

- [ ] **Step 3: Test shortlist callback isolation**

`JobAssistantActions.test.tsx`:

```tsx
it("uses the direct shortlist callback instead of an Agent analysis callback", async () => {
  const user = userEvent.setup();
  const onShortlist = vi.fn();
  const onAnalyze = vi.fn();
  render(
    <JobAssistantActions
      onAnalyze={onAnalyze}
      onGap={vi.fn()}
      onShortlist={onShortlist}
      onGreeting={vi.fn()}
    />
  );
  await user.click(screen.getByRole("button", { name: "加入候选" }));
  expect(onShortlist).toHaveBeenCalledTimes(1);
  expect(onAnalyze).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Test factual progress selection**

Create `ApplicationProgressActions.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApplicationProgressActions } from "./ApplicationProgressActions";

describe("ApplicationProgressActions", () => {
  it("submits the explicitly selected factual status", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <ApplicationProgressActions currentStatus="queued" onUpdate={onUpdate} />
    );
    await user.selectOptions(screen.getByLabelText("求职进展"), "applied");
    await user.click(screen.getByRole("button", { name: "更新本地记录" }));
    expect(onUpdate).toHaveBeenCalledWith("applied");
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5: Run tests, build, and commit**

```bash
cd frontend
npm test
npm run build
cd ..
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/test frontend/src/features
git commit -m "test(frontend): cover deterministic job actions"
```

Expected: Vitest passes and production build succeeds.

---

### Task 13: Update workflow counts, tool UI, and documentation

**Files:**
- Modify: `backend/app/workflow/engine.py`
- Modify: `frontend/src/constants.ts`
- Modify: `README.md`
- Modify: `docs/technical-architecture.md`
- Modify: `docs/model-provider-architecture.md`
- Modify: `docs/implementation-roadmap.md`
- Create: `backend/tests/test_workflow_counts.py`

- [ ] **Step 1: Add a failing distinct-analysis count test**

Create `backend/tests/test_workflow_counts.py`:

```python
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app import db
from app.db import connect, init_db
from app.workflow.engine import refresh_workflow_status


class WorkflowCountTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = db.DB_PATH
        db.DB_PATH = Path(self.temp_dir.name) / "workflow.db"
        init_db()

    def tearDown(self) -> None:
        db.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_match_count_uses_distinct_jobs(self) -> None:
        with connect() as conn:
            profile_id = conn.execute(
                "INSERT INTO profiles (name) VALUES ('候选人')"
            ).lastrowid
            job_id = conn.execute(
                """
                INSERT INTO jobs (source_url, title, company)
                VALUES ('manual://workflow-count', 'Agent 工程师', '示例科技')
                """
            ).lastrowid
            conn.execute(
                """
                INSERT INTO match_results (
                    job_id, profile_id, score, level, analysis_version
                ) VALUES (?, ?, 80, 'recommended', 'job-match-v1')
                """,
                (job_id, profile_id),
            )
            conn.execute(
                """
                INSERT INTO match_results (
                    job_id, profile_id, score, level, analysis_version
                ) VALUES (?, ?, 82, 'recommended', 'job-match-v2')
                """,
                (job_id, profile_id),
            )
        status = refresh_workflow_status()
        self.assertEqual(status["counts"]["matches"], 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Change workflow aggregation**

Use:

```sql
SELECT COUNT(DISTINCT job_id) AS count FROM match_results
```

with the existing conversation filter. Keep application counts based on the unique current application rows.

- [ ] **Step 3: Update frontend tool inventory**

Replace old tool labels/profiles with the 12 new names. Descriptions must distinguish:

- search versus exact read;
- ranking versus deep analysis;
- evidence search versus structured context;
- triage versus application progress;
- local preparation versus external execution.

- [ ] **Step 4: Update project documentation**

Document the shared-service architecture, new risk classes, model-visible parameters, direct UI actions, and the exact 12-tool inventory. Remove retired names from current architecture sections; historical changelog entries remain unchanged.

- [ ] **Step 5: Run tests/build and commit**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -v
cd ../frontend
npm test
npm run build
cd ..
git add backend/app/workflow/engine.py backend/tests/test_workflow_counts.py frontend/src/constants.ts README.md docs/technical-architecture.md docs/model-provider-architecture.md docs/implementation-roadmap.md
git commit -m "docs(agent): document domain-oriented tool architecture"
```

---

### Task 14: Final regression and acceptance verification

**Files:**
- Verify: all files changed in Tasks 1-13
- Modify only if a verification failure identifies a concrete defect.

- [ ] **Step 1: Run backend verification**

```bash
cd backend
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m compileall -q app tests
```

Expected: every test passes; compileall has no output.

- [ ] **Step 2: Run frontend verification**

```bash
cd frontend
npm test
npm run build
```

Expected: all Vitest tests pass; TypeScript and Vite build succeed. Record any Vite chunk-size warning separately; it does not invalidate this tool-domain refactor unless the changed files introduce a new larger chunk.

- [ ] **Step 3: Run repository checks**

```bash
cd ..
git diff --check
git status --short
```

Expected: `git diff --check` is silent. `git status --short` shows only intentional uncommitted verification fixes, or is empty.

- [ ] **Step 4: Verify model-visible tool inventory**

Start the configured backend and request:

```bash
curl -s http://127.0.0.1:8000/agent/capabilities
```

Expected tool names are exactly:

```text
request_manual_job_import
search_local_jobs
get_candidate_context
get_job_detail
rank_local_jobs
analyze_job_match
analyze_resume_gap
search_local_evidence
set_job_triage
save_greeting_draft
queue_application
record_application_progress
```

- [ ] **Step 5: Run manual acceptance scenarios**

Using a disposable local database, verify:

1. Import two similar jobs, ask to analyze by vague title, and confirm the Agent waits for selection.
2. Ask to compare local jobs and confirm `rank_local_jobs` is called.
3. Ask for resume evidence and confirm `search_local_evidence` returns source excerpts and retrieval mode.
4. Click “加入候选” and confirm no Agent run starts while local triage changes.
5. Ask in chat to shortlist a job and confirm the same triage service result.
6. Queue a job twice and confirm one application record.
7. Record the job as applied by job name/ID and confirm `applied_at` is set.
8. Correct the status and confirm `applied_at` remains.
9. Confirm no UI or Agent message claims an external message or application was sent.

- [ ] **Step 6: Handle verification failures without an empty commit**

If a verification command fails, return to the task that introduced the failing behavior, add a regression test there, implement the smallest fix, rerun that task's focused tests and the full verification suite, then amend that task's commit with `git commit --amend --no-edit`. If every verification command passes, do not create an empty commit.

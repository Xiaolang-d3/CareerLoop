from __future__ import annotations

from pydantic import ValidationError

from ..domain import JobSearchQuery, ToolDefinition, ToolError, ToolResult
from ..errors import CapabilityNotSupportedError, UnknownRegistrationError
from ..platforms import JobPlatformRegistry, PlatformOperationError
from ..repositories import JobRepository
from .base import ToolContext


class SearchJobsTool:
    definition = ToolDefinition(
        name="search_jobs",
        description="根据关键词、城市和薪资等条件搜索招聘岗位",
        input_schema=JobSearchQuery.model_json_schema(),
    )

    def __init__(
        self,
        platforms: JobPlatformRegistry,
        jobs: JobRepository | None = None,
    ) -> None:
        self._platforms = platforms
        self._jobs = jobs or JobRepository()

    async def execute(self, arguments: dict, context: ToolContext) -> ToolResult:
        try:
            query = JobSearchQuery.model_validate(arguments)
            platform = self._platforms.get(context.platform_name)
            if not platform.capabilities().search_jobs:
                raise CapabilityNotSupportedError(
                    f"平台 {context.platform_name} 不支持岗位搜索"
                )
            jobs = await platform.search_jobs(query)
            stored = self._jobs.upsert_summaries(jobs)
            stored_ids = {row["source_url"]: row["id"] for row in stored}
            job_payloads = []
            for job in jobs:
                job_payload = job.model_dump(mode="json")
                if job.source_url in stored_ids:
                    job_payload["local_id"] = stored_ids[job.source_url]
                job_payloads.append(job_payload)
            return ToolResult(
                ok=True,
                status="done",
                data={
                    "platform": context.platform_name,
                    "jobs": job_payloads,
                    "persisted_count": len(stored),
                },
                message=(
                    f"在 {context.platform_name} 平台找到 {len(jobs)} 个岗位"
                    + (f"，已保存 {len(stored)} 个" if stored else "")
                ),
            )
        except ValidationError as exc:
            return ToolResult(
                ok=False,
                status="failed",
                message="岗位搜索参数不合法",
                error=ToolError(code="invalid_arguments", message=str(exc)),
            )
        except (UnknownRegistrationError, CapabilityNotSupportedError) as exc:
            return ToolResult(
                ok=False,
                status="failed",
                message=str(exc),
                error=ToolError(code="platform_unavailable", message=str(exc)),
            )
        except PlatformOperationError as exc:
            return ToolResult(
                ok=False,
                status="blocked" if exc.blocked else "failed",
                message=str(exc),
                error=ToolError(code=exc.code, message=str(exc)),
            )

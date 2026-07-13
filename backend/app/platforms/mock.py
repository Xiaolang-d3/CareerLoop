from __future__ import annotations

from ..domain import Job, JobSearchQuery, JobSummary, PlatformCapabilities, SalaryRange
from .base import AuthStatus, SessionStatus


class MockJobPlatform:
    name = "mock"

    def __init__(self) -> None:
        self._jobs = [
            Job(
                platform=self.name,
                external_id="mock-ai-agent-001",
                source_url="mock://jobs/mock-ai-agent-001",
                title="AI Agent 应用工程师",
                company="未来智能科技",
                location="上海",
                salary=SalaryRange(minimum=25000, maximum=40000, months=14, text="25-40K·14薪"),
                tags=["Python", "LLM", "Agent"],
                description="负责企业级 AI Agent 产品和工具调用工作流开发。",
                requirements=["Python", "大模型应用", "工具调用"],
            ),
            Job(
                platform=self.name,
                external_id="mock-llm-002",
                source_url="mock://jobs/mock-llm-002",
                title="大模型应用开发工程师",
                company="云图数据",
                location="深圳",
                salary=SalaryRange(minimum=22000, maximum=35000, months=13, text="22-35K·13薪"),
                tags=["FastAPI", "RAG", "LangGraph"],
                description="建设大模型应用平台、知识库和智能工作流。",
                requirements=["FastAPI", "RAG", "工作流编排"],
            ),
            Job(
                platform=self.name,
                external_id="mock-fullstack-003",
                source_url="mock://jobs/mock-fullstack-003",
                title="AI 全栈工程师",
                company="星河软件",
                location="杭州",
                salary=SalaryRange(minimum=20000, maximum=32000, months=14, text="20-32K·14薪"),
                tags=["React", "TypeScript", "Python"],
                description="负责 AI 产品前端体验及 Python 服务端能力建设。",
                requirements=["React", "TypeScript", "Python"],
            ),
        ]

    def capabilities(self) -> PlatformCapabilities:
        return PlatformCapabilities(search_jobs=True, read_job_detail=True)

    async def start_session(self) -> SessionStatus:
        return SessionStatus(running=True, message="Mock Platform 已就绪")

    async def check_auth(self) -> AuthStatus:
        return AuthStatus(status="authenticated", message="Mock Platform 无需登录")

    async def search_jobs(self, query: JobSearchQuery) -> list[JobSummary]:
        cities = {city.strip().lower() for city in query.cities if city.strip()}
        jobs = self._jobs
        if cities:
            jobs = [job for job in jobs if job.location.lower() in cities]
        return [JobSummary.model_validate(job.model_dump()) for job in jobs[: query.limit]]

    async def get_job_detail(self, external_id: str) -> Job:
        for job in self._jobs:
            if job.external_id == external_id:
                return job
        raise LookupError(f"Mock 岗位不存在：{external_id}")

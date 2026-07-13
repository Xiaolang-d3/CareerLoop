from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel

from ..domain import Job, JobSearchQuery, JobSummary, PlatformCapabilities
from ..registry import NamedRegistry


class SessionStatus(BaseModel):
    running: bool
    message: str = ""


class AuthStatus(BaseModel):
    status: Literal["authenticated", "unauthenticated", "unknown", "blocked"]
    message: str = ""


class PlatformOperationError(RuntimeError):
    def __init__(self, code: str, message: str, blocked: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.blocked = blocked


class JobPlatform(Protocol):
    name: str

    def capabilities(self) -> PlatformCapabilities:
        ...

    async def start_session(self) -> SessionStatus:
        ...

    async def check_auth(self) -> AuthStatus:
        ...

    async def search_jobs(self, query: JobSearchQuery) -> list[JobSummary]:
        ...

    async def get_job_detail(self, external_id: str) -> Job:
        ...


class JobPlatformRegistry(NamedRegistry[JobPlatform]):
    def __init__(self) -> None:
        super().__init__("招聘平台")

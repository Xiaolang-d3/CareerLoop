from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SalaryRange(BaseModel):
    minimum: int | None = Field(default=None, ge=0)
    maximum: int | None = Field(default=None, ge=0)
    months: int | None = Field(default=None, ge=1)
    currency: str = "CNY"
    text: str = ""


class JobSearchQuery(BaseModel):
    keywords: list[str] = Field(default_factory=list)
    cities: list[str] = Field(default_factory=list)
    salary_minimum: int | None = Field(default=None, ge=0)
    experience: str = ""
    limit: int = Field(default=10, ge=1, le=50)


class JobSummary(BaseModel):
    platform: str
    external_id: str
    source_url: str
    title: str
    company: str
    location: str = ""
    salary: SalaryRange | None = None
    tags: list[str] = Field(default_factory=list)


class Job(JobSummary):
    description: str = ""
    requirements: list[str] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)


class JobMatch(BaseModel):
    job: JobSummary
    score: int = Field(ge=0, le=100)
    level: str
    reasons: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)

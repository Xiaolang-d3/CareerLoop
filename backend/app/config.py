from __future__ import annotations

import os
from functools import lru_cache

from pydantic import BaseModel, Field


class Settings(BaseModel):
    model_provider: str = "fake"
    model_name: str = "fake-model"
    job_platform: str = "mock"
    model_max_tool_rounds: int = Field(default=5, ge=1, le=20)


@lru_cache
def get_settings() -> Settings:
    return Settings(
        model_provider=os.getenv("MODEL_PROVIDER", "fake"),
        model_name=os.getenv("MODEL_NAME", "fake-model"),
        job_platform=os.getenv("JOB_PLATFORM", "mock"),
        model_max_tool_rounds=os.getenv("MODEL_MAX_TOOL_ROUNDS", "5"),
    )

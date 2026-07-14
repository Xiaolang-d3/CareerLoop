from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


class Settings(BaseModel):
    model_provider: str = "fake"
    model_name: str = "fake-model"
    model_base_url: str | None = None
    openai_api_key: str | None = None
    job_platform: str = "mock"
    model_max_tool_rounds: int = Field(default=5, ge=1, le=20)


@lru_cache
def get_settings() -> Settings:
    return Settings(
        model_provider=os.getenv("MODEL_PROVIDER", "fake"),
        model_name=os.getenv("MODEL_NAME", "fake-model"),
        model_base_url=os.getenv("MODEL_BASE_URL") or None,
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        job_platform=os.getenv("JOB_PLATFORM", "mock"),
        model_max_tool_rounds=os.getenv("MODEL_MAX_TOOL_ROUNDS", "5"),
    )

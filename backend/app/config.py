from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field
from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


class Settings(BaseModel):
    model_provider: str = "openai"
    model_name: str = "gpt-5.5"
    model_base_url: str | None = None
    openai_api_key: str | None = None
    model_timeout_seconds: float = Field(default=60, gt=0, le=300)
    job_platform: str = "boss"
    model_max_tool_rounds: int = Field(default=5, ge=1, le=20)


@lru_cache
def get_settings() -> Settings:
    return Settings(
        model_provider=os.getenv("MODEL_PROVIDER", "openai"),
        model_name=os.getenv("MODEL_NAME", "gpt-5.5"),
        model_base_url=os.getenv("MODEL_BASE_URL") or None,
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        model_timeout_seconds=os.getenv("MODEL_TIMEOUT_SECONDS", "60"),
        job_platform=os.getenv("JOB_PLATFORM", "boss"),
        model_max_tool_rounds=os.getenv("MODEL_MAX_TOOL_ROUNDS", "5"),
    )

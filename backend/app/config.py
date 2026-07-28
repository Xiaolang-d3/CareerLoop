from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

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
    model_max_tool_rounds: int = Field(default=5, ge=1, le=20)
    attachment_storage: Literal["local", "minio"] = "local"
    minio_endpoint: str | None = None
    minio_access_key: str | None = None
    minio_secret_key: str | None = None
    minio_bucket: str = "bosscopilot-attachments"
    minio_secure: bool = False
    minio_public_endpoint: str | None = None
    attachment_vision_enabled: bool = False
    attachment_vision_url_ttl_seconds: int = Field(default=300, ge=60, le=3600)
    web_research_enabled: bool = False
    agent_search_base_url: str = "http://127.0.0.1:3939"
    agent_search_token: str | None = None
    web_research_timeout_seconds: float = Field(default=25, gt=0, le=120)
    web_research_max_sources: int = Field(default=10, ge=3, le=20)


@lru_cache
def get_settings() -> Settings:
    return Settings(
        model_provider=os.getenv("MODEL_PROVIDER", "openai"),
        model_name=os.getenv("MODEL_NAME", "gpt-5.5"),
        model_base_url=os.getenv("MODEL_BASE_URL") or None,
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        model_timeout_seconds=os.getenv("MODEL_TIMEOUT_SECONDS", "60"),
        model_max_tool_rounds=os.getenv("MODEL_MAX_TOOL_ROUNDS", "5"),
        attachment_storage=os.getenv("ATTACHMENT_STORAGE", "local"),
        minio_endpoint=os.getenv("MINIO_ENDPOINT") or None,
        minio_access_key=os.getenv("MINIO_ACCESS_KEY") or None,
        minio_secret_key=os.getenv("MINIO_SECRET_KEY") or None,
        minio_bucket=os.getenv("MINIO_BUCKET", "bosscopilot-attachments"),
        minio_secure=os.getenv("MINIO_SECURE", "false").lower() == "true",
        minio_public_endpoint=os.getenv("MINIO_PUBLIC_ENDPOINT") or None,
        attachment_vision_enabled=os.getenv("ATTACHMENT_VISION_ENABLED", "false").lower() == "true",
        attachment_vision_url_ttl_seconds=os.getenv("ATTACHMENT_VISION_URL_TTL_SECONDS", "300"),
        web_research_enabled=os.getenv("WEB_RESEARCH_ENABLED", "false").lower() == "true",
        agent_search_base_url=os.getenv("AGENT_SEARCH_BASE_URL", "http://127.0.0.1:3939"),
        agent_search_token=os.getenv("AGENT_SEARCH_TOKEN") or None,
        web_research_timeout_seconds=os.getenv("WEB_RESEARCH_TIMEOUT_SECONDS", "25"),
        web_research_max_sources=os.getenv("WEB_RESEARCH_MAX_SOURCES", "10"),
    )

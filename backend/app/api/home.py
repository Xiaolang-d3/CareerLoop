from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr

from ..feeds.service import FeedCacheError, get_feed, save_preferences, set_item_state, start_refresh


router = APIRouter()


class HomePreferencesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    topics: list[StrictStr] = Field(max_length=6)
    repositories: list[StrictStr] = Field(max_length=8)


class HomeItemStateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bookmarked: StrictBool | None = None
    hidden: StrictBool | None = None


@router.get("/home/feed")
def home_feed_get() -> dict[str, Any]:
    try:
        return get_feed()
    except FeedCacheError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/home/feed/refresh")
def home_feed_refresh() -> dict[str, Any]:
    try:
        start_refresh(force=True)
        return get_feed(refresh_if_due=False)
    except FeedCacheError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.put("/home/preferences")
def home_preferences_put(payload: HomePreferencesIn) -> dict[str, Any]:
    try:
        return save_preferences(payload.topics, payload.repositories)
    except FeedCacheError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/home/feed/items/{item_id}/state")
def home_item_state_patch(item_id: str, payload: HomeItemStateIn) -> dict[str, Any]:
    try:
        return set_item_state(item_id, payload.model_dump(exclude_unset=True))
    except FeedCacheError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

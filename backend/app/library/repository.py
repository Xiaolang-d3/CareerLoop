"""Workspace-scoped library metadata."""
from pathlib import Path
from typing import Any

from ..db import connect, row_to_dict


def get_metadata(db_path: str | Path | None = None) -> dict[str, Any] | None:
    with connect(db_path) as conn:
        return row_to_dict(conn.execute("SELECT * FROM library_metadata WHERE id = 1").fetchone())


def save_metadata(*, name: str = "用户", privacy_mode: str = "redacted", locale: str = "zh-CN", db_path=None):
    if privacy_mode not in {"redacted", "original"}:
        raise ValueError("隐私模式不合法")
    with connect(db_path) as conn:
        conn.execute("""INSERT INTO library_metadata (id, name, privacy_mode, locale) VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, privacy_mode = excluded.privacy_mode, locale = excluded.locale, updated_at = CURRENT_TIMESTAMP""", (name.strip()[:100], privacy_mode, locale[:20]))
    return get_metadata(db_path)


def ensure_library(db_path=None):
    if get_metadata(db_path) is None:
        save_metadata(db_path=db_path)
    return 1

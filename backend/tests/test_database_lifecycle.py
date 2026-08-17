from __future__ import annotations

import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from app import db as db_module
from app.database_lifecycle import (
    REBUILD_CONFIRMATION,
    database_status,
    initialize_or_report,
    rebuild_database_v2,
)
from app.db import DB_SCHEMA_VERSION


def test_new_database_initializes_directly() -> None:
    with TemporaryDirectory() as directory:
        path = Path(directory) / "new.db"
        state = initialize_or_report(path)
        assert state["status"] == "ready"
        assert state["schema_version"] == DB_SCHEMA_VERSION


def test_legacy_database_requires_confirmation_then_is_backed_up_and_rebuilt() -> None:
    with TemporaryDirectory() as directory:
        path = Path(directory) / "legacy.db"
        with sqlite3.connect(path) as conn:
            conn.execute("CREATE TABLE legacy_marker (value TEXT NOT NULL)")
            conn.execute("INSERT INTO legacy_marker (value) VALUES ('keep me')")

        assert initialize_or_report(path)["status"] == "requires_rebuild"
        with pytest.raises(ValueError):
            rebuild_database_v2("", path)
        assert database_status(path)["status"] == "requires_rebuild"

        rebuilt = rebuild_database_v2(REBUILD_CONFIRMATION, path)
        assert rebuilt["status"] == "ready"
        backup_path = Path(rebuilt["backup_path"])
        assert backup_path.exists()
        with sqlite3.connect(backup_path) as conn:
            assert conn.execute("SELECT value FROM legacy_marker").fetchone()[0] == "keep me"
        with sqlite3.connect(path) as conn:
            tables = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
        assert "candidate_memory_items" in tables
        assert "legacy_marker" not in tables


def test_legacy_bosscopilot_database_is_renamed_on_adoption(monkeypatch: pytest.MonkeyPatch) -> None:
    with TemporaryDirectory() as directory:
        legacy_path = Path(directory) / "bosscopilot.db"
        new_path = Path(directory) / "careerloop.db"
        with sqlite3.connect(legacy_path) as conn:
            conn.execute("CREATE TABLE marker (value TEXT NOT NULL)")
            conn.execute("INSERT INTO marker (value) VALUES ('legacy data')")
        Path(f"{legacy_path}-wal").touch()

        monkeypatch.setattr(db_module, "LEGACY_DB_PATH", legacy_path)
        monkeypatch.setattr(db_module, "DB_PATH", new_path)
        db_module.adopt_legacy_database()

        assert not legacy_path.exists()
        assert not Path(f"{legacy_path}-wal").exists()
        assert Path(f"{new_path}-wal").exists()
        with sqlite3.connect(new_path) as conn:
            assert conn.execute("SELECT value FROM marker").fetchone()[0] == "legacy data"

        # Re-running after adoption must be a no-op.
        db_module.adopt_legacy_database()
        assert new_path.exists()


def test_existing_migration_ledger_receives_additive_upgrade() -> None:
    with TemporaryDirectory() as directory:
        path = Path(directory) / "existing.db"
        initialize_or_report(path)
        with sqlite3.connect(path) as conn:
            conn.execute("DELETE FROM schema_migrations WHERE version IN (?, ?)", (10, DB_SCHEMA_VERSION))
            conn.execute("DROP TABLE candidate_sources")
            conn.execute("DROP TABLE profiles")

        upgraded = initialize_or_report(path)

        assert upgraded["status"] == "ready"
        assert upgraded["schema_version"] == DB_SCHEMA_VERSION
        with sqlite3.connect(path) as conn:
            assert conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'candidate_sources'"
            ).fetchone()
            assert conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profiles'"
            ).fetchone()

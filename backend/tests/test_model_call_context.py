import asyncio

from app.observability.model_context import current_model_call, model_call_scope, public_model_selection


def test_parallel_calls_have_isolated_identity_and_restore_context():
    async def call(name):
        with model_call_scope({"profile_id": name, "connection_id": name, "secret_ref": "private-ref", "api_key": "synthetic-key"}, "run", "plan") as identity:
            await asyncio.sleep(0)
            assert current_model_call()["profile_id"] == name
            assert "api_key" not in identity and "secret_ref" not in identity
            return identity["call_id"]
    async def scenario():
        return await asyncio.gather(call("first"), call("second"))
    first, second = asyncio.run(scenario())
    assert first != second
    assert current_model_call() == {}


def test_public_selection_removes_credentials_from_all_stages():
    selected = public_model_selection({
        "profile_id": "execute", "model_name": "model", "secret_ref": "private-ref", "api_key": "synthetic-key",
        "stage_selections": {"plan": {"profile_id": "planner", "secret_ref": "private-ref", "api_key": "synthetic-key"}},
    })
    assert selected == {"profile_id": "execute", "model_name": "model", "stage_selections": {"plan": {"profile_id": "planner"}}}


def test_monitor_separates_same_model_and_address_by_identity_and_version(tmp_path):
    from app.db import connect, init_db
    from app.observability.model_monitor import get_model_monitor_snapshot, record_model_service_event

    database = tmp_path / "monitor.db"
    init_db(database)
    first = {"profile_id": "first-profile", "connection_id": "first-connection", "profile_revision": 1, "connection_revision": 1,
             "model_name": "same-model", "model_base_url": "https://shared.example.test/v1", "model_protocol": "openai", "resolved_model_protocol": "openai", "api_key": "synthetic-key"}
    second = {**first, "profile_id": "second-profile", "connection_id": "second-connection"}
    for index, selected in enumerate((first, second, {**first, "connection_revision": 2})):
        with model_call_scope(selected, run_id=f"run-{index}", stage="execute"):
            record_model_service_event(request_kind="generate", status="success", latency_ms=20,
                                       model_name=selected["model_name"], base_url=selected["model_base_url"],
                                       total_tokens=15, input_tokens=10, output_tokens=5, db_path=database)
    snapshot = get_model_monitor_snapshot(db_path=database, connection=first)
    assert snapshot["summary"]["total_requests"] == 1
    assert snapshot["summary"]["input_tokens"] == 10
    assert snapshot["summary"]["output_tokens"] == 5
    assert snapshot["recent_events"][0]["run_id"] == "run-0"
    with connect(database) as conn:
        rows = [dict(row) for row in conn.execute("SELECT * FROM model_service_events")]
    assert all("synthetic-key" not in str(row) for row in rows)

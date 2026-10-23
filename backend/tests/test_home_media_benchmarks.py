import copy
import json
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest

from app.feeds import benchmarks, media_benchmarks as media, service, sources
from test_home_feeds_service import NOW, home_workspace, immediate_refresh

KEY = "fixture-media-key-not-secret"


def model(index=1, **extra):
    return {"id": f"media-{index}", "name": f"Image Model {index}", "model_creator": {"id": "lab", "name": "New Lab"}, "elo": 1200 + index, "ci_95": 11, **extra}


def test_free_media_contract_preserves_all_models_and_distinct_scores(monkeypatch):
    calls = []
    original = httpx.Client
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"tier": "free", "api_key": KEY, "data": [model(i, bba_score=.54, fdb_score=None, tau_voice_score=.37, aa_wer_index=.045) for i in range(60)]})
    monkeypatch.setattr("app.config.get_settings", lambda: SimpleNamespace(artificial_analysis_api_key=KEY))
    monkeypatch.setattr(media.httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    rows = media.fetch(media.BOARDS[0])
    assert len(rows) == 60
    assert str(calls[0].url) == "https://artificialanalysis.ai/api/v2/media/text-to-image/models/free"
    assert calls[0].headers["x-api-key"] == KEY
    assert rows[0]["bba_score"] == .54
    assert rows[0]["fdb_score"] is None
    assert rows[0]["tau_voice_score"] == .37
    assert rows[0]["wer"] == .045
    assert rows[0]["ci_95"] == 11
    assert KEY not in json.dumps(rows)
    assert "price" not in rows[0]


def test_missing_invalid_and_zero_media_metrics():
    rows = media.normalize({"tier": "free", "data": [model(elo=None, ci_95=True, bba_score=float("inf"), aa_wer_index=0), model(2, elo=0, ci_95=-1)]}, media.BOARDS[-1])
    assert rows[0]["elo"] is None
    assert rows[0]["ci_95"] is None
    assert rows[0]["bba_score"] is None
    assert rows[0]["wer"] == 0
    assert rows[1]["elo"] == 0
    assert rows[1]["ci_95"] is None
    for payload in ({"tier": "free", "data": [{}]}, {"tier": "free", "models": []}, {"tier": "unknown", "data": []}):
        with pytest.raises(ValueError):
            media.normalize(payload, media.BOARDS[0])


@pytest.mark.parametrize("status", [301, 401, 403, 429, 500])
def test_media_errors_are_sanitized_and_redirects_never_followed(monkeypatch, status):
    original = httpx.Client
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, headers={"Location": "https://evil.test/"}, text=KEY)
    monkeypatch.setattr("app.config.get_settings", lambda: SimpleNamespace(artificial_analysis_api_key=KEY))
    monkeypatch.setattr(media.httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(ValueError) as error:
        media.fetch(media.BOARDS[0])
    assert KEY not in str(error.value)
    assert len(calls) == 1


def test_media_size_limit_and_missing_key(monkeypatch):
    original = httpx.Client
    monkeypatch.setattr("app.config.get_settings", lambda: SimpleNamespace(artificial_analysis_api_key=KEY))
    monkeypatch.setattr(media.httpx, "Client", lambda **kwargs: original(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b"x" * 51)), **kwargs))
    monkeypatch.setattr(benchmarks, "MAX_RESPONSE_BYTES", 50)
    with pytest.raises(ValueError, match="大小限制"):
        media.fetch(media.BOARDS[0])
    monkeypatch.setattr("app.config.get_settings", lambda: SimpleNamespace(artificial_analysis_api_key=None))
    monkeypatch.setattr(media.httpx, "Client", lambda **kwargs: pytest.fail("Must not send request without key"))
    with pytest.raises(ValueError, match="尚未配置"):
        media.fetch(media.BOARDS[0])


def test_media_snapshots_are_independent_and_preserve_language_and_stale_board(home_workspace, immediate_refresh, monkeypatch):
    monkeypatch.setattr(benchmarks, "configured", lambda: True)
    def fetch(source):
        if source.adapter == "aa_api":
            return [{"id": "language", "name": "Language Model"}]
        if source.adapter == "aa_media":
            board = next(board for board in media.BOARDS if board.source_id == source.id)
            return media.normalize({"tier": "free", "data": [model(name=board.label)]}, board)
        return []
    monkeypatch.setattr(sources, "fetch_source", fetch)
    first = service.get_feed()["model_benchmarks"]
    assert first["models"][0]["id"] == "language"
    assert len(first["media"]) == 9
    assert {row["category"] for row in first["media"]} == {"image", "video", "speech"}
    assert first["media"][0]["models"][0]["name"] == "图像生成"
    monkeypatch.setattr(service, "_now", lambda: NOW + timedelta(hours=7))
    def failing(source):
        if source.id == media.BOARDS[0].source_id:
            raise ValueError("此榜单更新失败")
        return copy.deepcopy(fetch(source))
    monkeypatch.setattr(sources, "fetch_source", failing)
    stale = service.get_feed()["model_benchmarks"]
    assert stale["status"] == "ready"
    assert stale["media"][0]["status"] == "error"
    assert stale["media"][0]["models"] == first["media"][0]["models"]
    assert stale["media"][0]["collected_at"] == first["media"][0]["collected_at"]
    assert stale["media"][1]["status"] == "ready"
    assert KEY not in json.dumps(stale)

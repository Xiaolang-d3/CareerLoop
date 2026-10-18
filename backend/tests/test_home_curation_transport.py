from __future__ import annotations

import json
from types import SimpleNamespace

import httpx

from app.domain import ModelResponse
from app.feeds import curation, service
from app.observability.model_context import current_model_call
from app.research.tavily import TavilySearchClient
from test_home_curation import ARTICLE, home_workspace, pipeline


def test_real_search_adapter_http_contract_reaches_curated_home_snapshot(home_workspace, pipeline, monkeypatch):
    requests = []

    def transport(request):
        payload = json.loads(request.content)
        requests.append((request.url.path, payload))
        return httpx.Response(200, json={"results": [{"url": ARTICLE["url"], "title": ARTICLE["title"], "published_date": ARTICLE["published_at"], "content": ARTICLE["snippet"], "raw_content": ARTICLE["content"], "score": 0.9}]})

    client = TavilySearchClient(api_key="fixture-not-a-secret", transport=httpx.MockTransport(transport))
    monkeypatch.setattr("app.research.web.is_public_source_url", lambda url: url.startswith("https://openai.com/"))
    monkeypatch.setattr(curation, "_build_search_client", lambda: client)
    service.save_preferences(["Agent"], [], "editor", curation_enabled=True)
    result = service.get_feed(refresh_if_due=False)["curation"]
    assert result["status"] == "ready"
    assert len(result["items"]) == 1
    assert len(requests) == 3
    assert all(path == "/search" and payload["topic"] == "news" and payload["max_results"] == 8 for path, payload in requests)
    assert all(payload["include_raw_content"] == "markdown" for _, payload in requests)


def test_editor_uses_real_model_request_path_with_curation_monitoring(monkeypatch):
    seen = []

    class TextProvider:
        async def generate(self, request):
            seen.append((request, current_model_call()))
            return ModelResponse(content='{"items":[]}')

    monkeypatch.setattr("app.config.get_settings", lambda: SimpleNamespace(model_timeout_seconds=5))
    monkeypatch.setattr("app.models.build_model_provider", lambda **kwargs: TextProvider())
    monkeypatch.setattr("app.models.configured.configure_model_provider", lambda provider, parameters, effort: provider)
    response = curation._request_model({"profile_id": "editor", "model_name": "fixture-model", "api_key": "fixture-only"}, "公开候选")
    assert response == '{"items":[]}'
    request, metadata = seen[0]
    assert request.messages[0].content == "公开候选"
    assert request.parameters["max_output_tokens"] == 2800
    assert not request.tools
    assert metadata["stage"] == "curation"
    assert metadata["selection_reason"] == "home_curation"
    assert metadata["profile_id"] == "editor"

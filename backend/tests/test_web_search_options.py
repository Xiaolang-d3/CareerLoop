from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.api.chat import _ag_ui_web_search_fields
from app.chat.contracts import ChatMessageIn
from app.search_options import WebSearchOptions, normalize_web_search_options, web_search_options_from_payload
from ag_ui.core import RunAgentInput


class WebSearchOptionsTest(unittest.TestCase):
    def test_legacy_modes_map_to_separate_topic_and_preference(self) -> None:
        for mode, topic, preference in [
            ("auto", "auto", "none"), ("general", "general", "none"),
            ("technical", "general", "technical"),
        ]:
            with self.subTest(mode=mode):
                options = web_search_options_from_payload({"web_search": True, "web_search_mode": mode})
                self.assertEqual((options.enabled, options.topic, options.source_preference), (True, topic, preference))

    def test_explicit_fields_override_legacy_and_missing_fields_inherit(self) -> None:
        base = WebSearchOptions(enabled=True, topic="news", source_preference="technical", provider="tavily")
        self.assertEqual(normalize_web_search_options(base=base), base)
        changed = normalize_web_search_options(base=base, enabled=False, topic="auto", source_preference="none")
        self.assertFalse(changed.enabled)
        self.assertEqual((changed.topic, changed.source_preference, changed.provider), ("auto", "none", "tavily"))
        current = normalize_web_search_options(legacy_mode="technical", topic="finance", source_preference="none")
        self.assertEqual((current.topic, current.source_preference), ("finance", "none"))

    def test_historical_unknown_or_invalid_permission_fails_closed(self) -> None:
        for payload in [None, {}, {"web_search": "true"}, {"web_search_options": {"enabled": True, "version": 2}},
                        {"web_search": True, "web_search_mode": "unknown"}, {"web_search_options": {"enabled": "true"}}]:
            with self.subTest(payload=payload):
                self.assertFalse(web_search_options_from_payload(payload).enabled)

    def test_internal_contract_rejects_invalid_values_and_non_boolean_consent(self) -> None:
        for fields in [{"web_search": "true"}, {"web_search_topic": "company"},
                       {"web_search_source_preference": "official"}, {"web_search_mode": "news"}, {"web_search_provider": "unknown"}]:
            with self.subTest(fields=fields), self.assertRaises(ValidationError):
                ChatMessageIn(content="question", **fields)
        with self.assertRaises(ValidationError):
            WebSearchOptions().enabled = True

    def test_ag_ui_preserves_absence_and_explicit_defaults(self) -> None:
        def dto(forwarded):
            value = RunAgentInput.model_validate({
                "threadId": "1", "runId": "test", "state": {}, "messages": [],
                "tools": [], "context": [], "forwardedProps": forwarded,
            })
            return ChatMessageIn(content="question", **_ag_ui_web_search_fields(value))
        missing = dto({})
        self.assertEqual(missing.model_fields_set, {"content"})
        explicit = dto({"webSearch": False, "webSearchTopic": "auto", "webSearchSourcePreference": "none", "webSearchProvider": "tavily"})
        self.assertEqual(explicit.model_fields_set, {"content", "web_search", "web_search_topic", "web_search_source_preference", "web_search_provider"})

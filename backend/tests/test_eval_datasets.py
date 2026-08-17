from __future__ import annotations

import unittest

from app.agent.eval_harness import assert_eval_expected, load_eval_cases, run_eval_case


class EvalDatasetTest(unittest.TestCase):
    def test_route_and_citation_goldens(self) -> None:
        cases = load_eval_cases("routes.json", "citations.json", "model_behavior.json")
        self.assertGreaterEqual(len(cases), 50)
        for case in cases:
            with self.subTest(case.get("description")):
                result = run_eval_case(case)
                assert_eval_expected(result, (case.get("vars") or {}).get("expected") or {})

from __future__ import annotations

import json
import unittest

from kivviq_evidence_lab.model import RequestSemantics
from kivviq_evidence_lab.phase2.candidates.candidate1 import Candidate1ModelResolver
from kivviq_evidence_lab.phase2.development import REFERENCE


class _CapturingModel:
    model_id = "synthetic-test-model"

    def __init__(self, response: str) -> None:
        self.response = response
        self.system_prompt = ""
        self.user_prompt = ""

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        self.system_prompt = system_prompt
        self.user_prompt = user_prompt
        return self.response


def _request_payload(
    *,
    metric: str = "ad_spend",
    source: str = "ads.paid_social",
    scope: str = "provider",
) -> dict[str, object]:
    return {
        "intent": "metric",
        "metric": metric,
        "source_provider": source,
        "scope": scope,
        "breakdown_dimension": None,
        "period": {"start": "2026-08-01", "end": "2026-08-31", "label": "last month"},
        "comparison_period": None,
        "currency": "CAD",
        "aggregation": "sum",
        "attribution_basis": None,
        "profit_basis": None,
        "journey_requirement": None,
        "freshness_requirement": None,
        "ambiguous_reasons": [],
    }


class Candidate1ModelResolverTests(unittest.TestCase):
    def test_parses_typed_model_output(self) -> None:
        model = _CapturingModel(json.dumps({"requests": [_request_payload()]}))
        candidate = Candidate1ModelResolver(model)
        result = candidate.resolve("Meta spend last month?", REFERENCE)
        self.assertEqual(len(result.requests), 1)
        request = result.requests[0]
        self.assertEqual(request.metric, "ad_spend")
        self.assertEqual(request.source_provider, "ads.paid_social")
        self.assertEqual(request.period.start.isoformat(), "2026-08-01")  # type: ignore[union-attr]
        self.assertEqual(candidate.model_id, "synthetic-test-model")

    def test_supports_multiple_requests(self) -> None:
        payload = {
            "requests": [
                _request_payload(),
                _request_payload(source="ads.search"),
            ]
        }
        candidate = Candidate1ModelResolver(_CapturingModel(json.dumps(payload)))
        result = candidate.resolve("Meta spend and Google spend last month.", REFERENCE)
        self.assertEqual(tuple(request.source_provider for request in result.requests), ("ads.paid_social", "ads.search"))

    def test_rejects_untyped_or_unknown_vocabulary(self) -> None:
        payload = _request_payload(metric="made_up_metric")
        candidate = Candidate1ModelResolver(_CapturingModel(json.dumps({"requests": [payload]})))
        with self.assertRaisesRegex(ValueError, "unsupported metric"):
            candidate.resolve("anything", REFERENCE)

    def test_rejects_extra_top_level_keys(self) -> None:
        candidate = Candidate1ModelResolver(
            _CapturingModel(json.dumps({"requests": [_request_payload()], "claim_is_true": True}))
        )
        with self.assertRaisesRegex(ValueError, "only the requests key"):
            candidate.resolve("anything", REFERENCE)

    def test_prompt_excludes_evidence_and_holdout_truth(self) -> None:
        model = _CapturingModel(json.dumps({"requests": [_request_payload()]}))
        candidate = Candidate1ModelResolver(model)
        candidate.resolve("Meta spend last month?", REFERENCE)
        lowered = model.system_prompt.lower()
        self.assertNotIn("phase2_evaluator", lowered)
        self.assertNotIn("holdout_digest", lowered)
        self.assertNotIn("evidencefact", lowered)
        self.assertIn("never decide whether a claim is true", lowered)

    def test_context_is_structured_and_bounded(self) -> None:
        model = _CapturingModel(json.dumps({"requests": [_request_payload(source="ads.search")]}))
        candidate = Candidate1ModelResolver(model)
        prior = RequestSemantics(
            "metric",
            "ad_spend",
            "ads.paid_social",
            "provider",
            None,
            None,
        )
        candidate.resolve("What about Google?", REFERENCE, tuple(prior for _ in range(9)))
        user_payload = json.loads(model.user_prompt)
        self.assertEqual(len(user_payload["legitimate_context"]), 6)
        self.assertEqual(user_payload["merchant_message"], "What about Google?")


if __name__ == "__main__":
    unittest.main()

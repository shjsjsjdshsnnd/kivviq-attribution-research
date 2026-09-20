from __future__ import annotations

import unittest
from dataclasses import replace

from kivviq_evidence_lab.benchmark import REFERENCE
from kivviq_evidence_lab.contracts import contract_for_request
from kivviq_evidence_lab.governor import EvidenceGovernor
from kivviq_evidence_lab.model import ExpectedOutcome, FailureClass, FreshnessState, MeasurementStatus, ProposedAnswer, RequestSemantics
from kivviq_evidence_lab.periods import resolve_period
from kivviq_evidence_lab.registry import MetricRegistry
from kivviq_evidence_lab.retrieval import EvidenceRetriever
from kivviq_evidence_lab.world import SyntheticWorld


class RetrievalGovernorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.world = SyntheticWorld()
        self.registry = MetricRegistry()
        self.gov = EvidenceGovernor()
        self.p = resolve_period("last 7 days", REFERENCE)

    def test_store_revenue_precedence_selects_commerce(self) -> None:
        req = RequestSemantics("metric", "total_sales", "commerce", "all_channels", None, self.p)
        candidates = [
            self.world.fact("analytics_revenue", "analytics", "all_channels", self.p, currency="CAD"),
            self.world.fact("total_sales", "commerce", "all_channels", self.p, currency="CAD"),
            self.world.fact("platform_attributed_revenue", "ads.paid_social", "provider", self.p, currency="CAD"),
        ]
        selected = EvidenceRetriever().select(req, candidates)
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0].source, "commerce")

    def test_provider_failure_does_not_contaminate_meta(self) -> None:
        self.world.fail_provider("ads.search")
        req = RequestSemantics("metric", "ad_spend", "ads.paid_social", "provider", None, self.p, freshness_requirement="fresh")
        fact = self.world.fact("ad_spend", "ads.paid_social", "provider", self.p, currency="CAD")
        answer = ProposedAnswer("ad_spend", "ads.paid_social", "provider", self.p, fact.value, (fact,))
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertEqual(result.outcome, ExpectedOutcome.SUPPORTED_EXACT)

    def test_unavailable_is_not_zero(self) -> None:
        self.world.fail_provider("ads.search")
        req = RequestSemantics("metric", "ad_spend", "ads.search", "provider", None, self.p)
        fact = self.world.fact("ad_spend", "ads.search", "provider", self.p, currency="CAD")
        self.assertIsNone(fact.value)
        answer = ProposedAnswer("ad_spend", "ads.search", "provider", self.p, None, (fact,))
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertEqual(result.outcome, ExpectedOutcome.UNAVAILABLE)

    def test_null_presented_as_zero_is_rejected(self) -> None:
        req = RequestSemantics("metric", "ad_spend", "ads.paid_social", "provider", None, self.p)
        fact = self.world.fact("ad_spend", "ads.paid_social", "provider", self.p, currency="CAD")
        fact = replace(fact, value=None, measurement_status=MeasurementStatus.NULL)
        answer = ProposedAnswer("ad_spend", "ads.paid_social", "provider", self.p, 0, (fact,))
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertIn(FailureClass.NULL_AS_ZERO, result.failures)
        self.assertFalse(result.supported)

    def test_stale_current_evidence_is_rejected(self) -> None:
        req = RequestSemantics("metric", "ad_spend", "ads.paid_social", "provider", None, self.p, freshness_requirement="fresh")
        fact = self.world.fact("ad_spend", "ads.paid_social", "provider", self.p, currency="CAD")
        fact = replace(fact, freshness=FreshnessState.STALE)
        answer = ProposedAnswer("ad_spend", "ads.paid_social", "provider", self.p, fact.value, (fact,))
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertEqual(result.outcome, ExpectedOutcome.STALE)

    def test_attributed_revenue_cannot_substitute_for_store_revenue(self) -> None:
        req = RequestSemantics("metric", "total_sales", "commerce", "all_channels", None, self.p)
        fact = self.world.fact("platform_attributed_revenue", "ads.paid_social", "provider", self.p, currency="CAD", attribution_basis="provider_reported")
        answer = ProposedAnswer("platform_attributed_revenue", "ads.paid_social", "all_channels", self.p, fact.value, (fact,))
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertIn(FailureClass.ATTRIBUTED_AS_STORE_REVENUE, result.failures)

    def test_causal_claim_requires_causal_evidence(self) -> None:
        req = RequestSemantics("causal_question", None, "ads.paid_social", "all_channels", None, self.p, attribution_basis="causal")
        answer = ProposedAnswer(None, "ads.paid_social", "all_channels", self.p, None, (), claims_causality=True)
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertEqual(result.outcome, ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM)

    def test_ordered_journey_requires_ordered_events(self) -> None:
        req = RequestSemantics("journey", "ordered_journey", "first_party", "purchasers", None, self.p, journey_requirement="ordered_events")
        fact = self.world.fact("ordered_journey", "first_party", "purchasers", self.p, supports_ordered_journey=False)
        answer = ProposedAnswer("ordered_journey", "first_party", "purchasers", self.p, fact.value, (fact,), claims_ordered_journey=True)
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertIn(FailureClass.FABRICATED_JOURNEY, result.failures)

    def test_contribution_requires_variable_cost_inputs(self) -> None:
        req = RequestSemantics("profitability", "contribution", "cost", "all_channels", None, self.p, profit_basis="contribution")
        fact = self.world.fact("contribution", "cost", "all_channels", self.p, currency="CAD", profit_basis="contribution")
        fact = replace(fact, quality={**fact.quality, "cost_inputs": ["cogs", "ad_spend"]})
        answer = ProposedAnswer("contribution", "cost", "all_channels", self.p, fact.value, (fact,), profit_basis="contribution")
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertIn(FailureClass.UNSUPPORTED_PROFIT, result.failures)

    def test_material_same_authority_disagreement_is_conflict(self) -> None:
        req = RequestSemantics("metric", "total_sales", "commerce", "all_channels", None, self.p)
        first = self.world.fact("total_sales", "commerce", "all_channels", self.p, currency="CAD")
        self.assertIsInstance(first.value, (int, float))
        first_value = float(first.value)
        second = replace(first, value=first_value * 1.002)
        answer = ProposedAnswer("total_sales", "commerce", "all_channels", self.p, first.value, (first, second))
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertEqual(result.outcome, ExpectedOutcome.CONFLICT)
        self.assertFalse(result.supported)
        self.assertIn(FailureClass.EVIDENCE_CONFLICT, result.failures)
        self.assertEqual(len(result.conflicts), 1)
        self.assertEqual(result.conflicts[0].metric_id, "total_sales")

    def test_immaterial_same_authority_difference_is_not_conflict(self) -> None:
        req = RequestSemantics("metric", "total_sales", "commerce", "all_channels", None, self.p)
        first = self.world.fact("total_sales", "commerce", "all_channels", self.p, currency="CAD")
        self.assertIsInstance(first.value, (int, float))
        first_value = float(first.value)
        second = replace(first, value=first_value * 1.0005)
        answer = ProposedAnswer("total_sales", "commerce", "all_channels", self.p, first.value, (first, second))
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertEqual(result.outcome, ExpectedOutcome.SUPPORTED_EXACT)
        self.assertEqual(result.conflicts, ())

    def test_one_tenth_percent_boundary_is_material(self) -> None:
        req = RequestSemantics("metric", "total_sales", "commerce", "all_channels", None, self.p)
        first = self.world.fact("total_sales", "commerce", "all_channels", self.p, currency="CAD")
        self.assertIsInstance(first.value, (int, float))
        first_value = float(first.value)
        second = replace(first, value=first_value * 1.0011)
        answer = ProposedAnswer("total_sales", "commerce", "all_channels", self.p, first.value, (first, second))
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertEqual(result.outcome, ExpectedOutcome.CONFLICT)

    def test_different_sources_are_not_same_authority_conflict(self) -> None:
        req = RequestSemantics("metric", "total_sales", "commerce", "all_channels", None, self.p)
        commerce = self.world.fact("total_sales", "commerce", "all_channels", self.p, currency="CAD")
        analytics = self.world.fact("analytics_revenue", "analytics", "all_channels", self.p, currency="CAD")
        selected = EvidenceRetriever().select(req, (commerce, analytics))
        answer = ProposedAnswer("total_sales", "commerce", "all_channels", self.p, commerce.value, selected)
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertEqual(result.outcome, ExpectedOutcome.SUPPORTED_EXACT)
        self.assertEqual(result.conflicts, ())

    def test_missing_provider_is_source_degraded(self) -> None:
        req = RequestSemantics("metric", "ad_spend", None, "all_ad_providers", "provider", self.p)
        facts = self.world.advertising_bundle("ad_spend", self.p)[1:]
        answer = ProposedAnswer("ad_spend", "multi_provider", "all_ad_providers", self.p, 1, facts, breakdown_dimension="provider", calculation="sum")
        result = self.gov.validate(answer, contract_for_request(req, self.registry))
        self.assertEqual(result.outcome, ExpectedOutcome.SOURCE_DEGRADED)

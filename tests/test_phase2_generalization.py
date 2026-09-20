from __future__ import annotations

import unittest
from datetime import datetime

from kivviq_evidence_lab.model import RequestSemantics
from kivviq_evidence_lab.phase2.candidates.deterministic import DeterministicResolverCandidate
from kivviq_evidence_lab.phase2.candidates.model_based import ModelBasedResolverCandidate
from kivviq_evidence_lab.phase2.contracts import SemanticBundle
from kivviq_evidence_lab.phase2.dev_eval import evaluate_development
from kivviq_evidence_lab.phase2.development import REFERENCE, generate_development_cases
from kivviq_evidence_lab.phase2.firewall import scan_candidate_isolation
from kivviq_evidence_lab.phase2_evaluator.evaluator import evaluate_holdout
from kivviq_evidence_lab.phase2_evaluator.holdout_v1 import HOLDOUT_VERSION, build_holdout_v1


class _FakeModelBackend:
    def infer(
        self,
        message: str,
        reference: datetime,
        context: tuple[RequestSemantics, ...],
    ) -> SemanticBundle:
        del message, reference, context
        return generate_development_cases()[0].expected


class Phase2ArchitectureTests(unittest.TestCase):
    def test_candidate_import_firewall_is_clean(self) -> None:
        self.assertEqual(scan_candidate_isolation("."), [])

    def test_development_suite_is_versioned_and_fixed_size(self) -> None:
        cases = generate_development_cases()
        self.assertEqual(len(cases), 96)
        self.assertEqual(len({case.case_id for case in cases}), 96)

    def test_holdout_suite_is_versioned_and_separate(self) -> None:
        suite = build_holdout_v1()
        self.assertEqual(HOLDOUT_VERSION, "phase2-holdout-v1.0.0")
        self.assertEqual(len(suite.semantic_cases), 160)
        self.assertEqual(suite.dialogue_turns, 16)
        self.assertEqual(len(suite.metamorphic_cases), 20)
        self.assertEqual(len(suite.governor_cases), 12)
        self.assertEqual(len(suite.contradiction_cases), 6)
        self.assertEqual(suite.evaluation_units, 214)
        self.assertEqual(len(suite.digest), 64)

    def test_model_candidate_accepts_only_typed_bundle(self) -> None:
        candidate = ModelBasedResolverCandidate(_FakeModelBackend())
        bundle = candidate.resolve("ignored", REFERENCE)
        self.assertIsInstance(bundle, SemanticBundle)
        self.assertEqual(bundle, generate_development_cases()[0].expected)

    def test_development_evaluator_reports_separate_dimensions(self) -> None:
        report = evaluate_development(DeterministicResolverCandidate())
        self.assertEqual(report["cases"], 96)
        for key in (
            "exact_semantic_accuracy",
            "metric_accuracy",
            "source_provider_accuracy",
            "scope_accuracy",
            "period_accuracy",
            "breakdown_dimension_accuracy",
        ):
            self.assertGreaterEqual(float(report[key]), 0.0)
            self.assertLessEqual(float(report[key]), 1.0)

    def test_holdout_evaluator_reports_required_dimensions(self) -> None:
        report = evaluate_holdout(DeterministicResolverCandidate())
        required = (
            "exact_semantic_resolution_accuracy",
            "metric_accuracy",
            "provider_accuracy",
            "scope_accuracy",
            "period_accuracy",
            "breakdown_accuracy",
            "ambiguity_precision",
            "ambiguity_recall",
            "false_ambiguity_rate",
            "false_certainty_rate",
            "conversational_context_accuracy",
            "multilingual_accuracy",
            "metamorphic_consistency",
            "evidence_governor_acceptance_accuracy",
            "unsupported_claim_rate",
            "false_refusal_rate",
            "contradiction_safety_accuracy",
        )
        self.assertEqual(report["evaluation_units"], 214)
        for key in required:
            self.assertGreaterEqual(float(report[key]), 0.0)
            self.assertLessEqual(float(report[key]), 1.0)

    def test_evidence_governor_firewall_remains_independent(self) -> None:
        report = evaluate_holdout(DeterministicResolverCandidate())
        self.assertEqual(report["evidence_governor_acceptance_accuracy"], 1.0)
        self.assertEqual(report["unsupported_claim_rate"], 0.0)
        self.assertEqual(report["false_refusal_rate"], 0.0)


if __name__ == "__main__":
    unittest.main()

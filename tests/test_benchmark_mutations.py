from __future__ import annotations

import unittest

from kivviq_evidence_lab.benchmark import generate_cases, run_benchmark
from kivviq_evidence_lab.mutations import run_mutation_suite


class BenchmarkMutationTests(unittest.TestCase):
    def test_benchmark_has_at_least_500_deterministic_cases(self) -> None:
        first = generate_cases()
        second = generate_cases()
        self.assertGreaterEqual(len(first), 500)
        self.assertEqual(first, second)

    def test_initial_benchmark_is_green(self) -> None:
        report = run_benchmark()
        self.assertEqual(report["cases"], 545)
        self.assertEqual(report["failed"], 0)
        self.assertEqual(report["false_refusal_rate"], 0.0)
        self.assertEqual(report["false_claim_rate"], 0.0)

    def test_dimensions_are_reported_separately(self) -> None:
        report = run_benchmark()
        for key in (
            "intent_resolution_accuracy", "metric_resolution_accuracy", "source_authority_accuracy",
            "scope_accuracy", "period_accuracy", "supported_answer_precision",
            "unsupported_answer_refusal_accuracy", "partial_failure_isolation_accuracy",
            "freshness_compliance", "causal_language_compliance", "journey_evidence_compliance",
        ):
            self.assertIn(key, report)

    def test_mutation_suite_detects_all_regressions(self) -> None:
        report = run_mutation_suite()
        self.assertEqual(report["total"], 10)
        self.assertEqual(report["detected"], report["total"])

from __future__ import annotations

import unittest
from datetime import date

from kivviq_evidence_lab.benchmark import REFERENCE
from kivviq_evidence_lab.periods import resolve_period
from kivviq_evidence_lab.semantics import SemanticResolver


class PeriodSemanticTests(unittest.TestCase):
    def setUp(self) -> None:
        self.resolver = SemanticResolver()

    def test_last_seven_days(self) -> None:
        p = resolve_period("last 7 days", REFERENCE)
        self.assertEqual((p.start, p.end), (date(2026, 9, 14), date(2026, 9, 20)))

    def test_last_seven_complete_days(self) -> None:
        p = resolve_period("last 7 complete days", REFERENCE)
        self.assertEqual((p.start, p.end), (date(2026, 9, 13), date(2026, 9, 19)))

    def test_last_week(self) -> None:
        p = resolve_period("last week", REFERENCE)
        self.assertEqual((p.start, p.end), (date(2026, 9, 7), date(2026, 9, 13)))

    def test_last_month(self) -> None:
        p = resolve_period("last month", REFERENCE)
        self.assertEqual((p.start, p.end), (date(2026, 8, 1), date(2026, 8, 31)))

    def test_custom_range(self) -> None:
        p = resolve_period("2026-08-03 to 2026-08-12", REFERENCE)
        self.assertEqual((p.start, p.end), (date(2026, 8, 3), date(2026, 8, 12)))

    def test_revenue_breakdown_is_not_ambiguous(self) -> None:
        r = self.resolver.resolve("What is my current revenue breakdown?", REFERENCE)
        self.assertEqual(r.metric, "total_sales")
        self.assertEqual(r.scope, "all_channels")
        self.assertEqual(r.breakdown_dimension, "sales_channel")
        self.assertFalse(r.is_ambiguous)

    def test_online_scope(self) -> None:
        r = self.resolver.resolve("How much did we make online last month?", REFERENCE)
        self.assertEqual((r.metric, r.source_provider, r.scope), ("total_sales", "commerce", "online"))

    def test_provider_spend(self) -> None:
        r = self.resolver.resolve("Meta spend last 7 days.", REFERENCE)
        self.assertEqual((r.metric, r.source_provider, r.scope), ("ad_spend", "ads.paid_social", "provider"))

    def test_ambiguous_pronoun_remains_ambiguous(self) -> None:
        r = self.resolver.resolve("How much did that make?", REFERENCE)
        self.assertTrue(r.is_ambiguous)

    def test_compare_channels_is_breakdown_not_ambiguity(self) -> None:
        r = self.resolver.resolve("Compare online and POS revenue last 30 days.", REFERENCE)
        self.assertEqual(r.intent, "comparison")
        self.assertEqual(r.breakdown_dimension, "sales_channel")
        self.assertFalse(r.is_ambiguous)

    def test_compare_periods_has_comparison_period(self) -> None:
        r = self.resolver.resolve("Compare revenue last 30 days with previous 30 days.", REFERENCE)
        self.assertIsNotNone(r.comparison_period)
        self.assertEqual(r.period.label, "last 30 days")  # type: ignore[union-attr]
        self.assertEqual(r.comparison_period.label, "previous 30 days")  # type: ignore[union-attr]

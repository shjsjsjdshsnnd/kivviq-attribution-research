from __future__ import annotations

import unittest
from dataclasses import replace
from datetime import date

from kivviq_evidence_lab.model import EvidenceFact, FreshnessState, MeasurementStatus, Period
from kivviq_evidence_lab.registry import MetricRegistry
from kivviq_evidence_lab.world import SyntheticWorld


class ModelRegistryTests(unittest.TestCase):
    def test_period_rejects_reverse_range(self) -> None:
        with self.assertRaises(ValueError):
            Period(date(2026, 9, 2), date(2026, 9, 1), "bad").validate()

    def test_fact_requires_provenance_fields(self) -> None:
        p = Period(date(2026, 9, 1), date(2026, 9, 2), "two days")
        fact = EvidenceFact("total_sales", "commerce", "all_channels", p, p, p, 100, "CAD", FreshnessState.FRESH, MeasurementStatus.MEASURED, "definition", 0.9)
        fact.validate()

    def test_unavailable_fact_cannot_have_numeric_value(self) -> None:
        p = Period(date(2026, 9, 1), date(2026, 9, 1), "one day")
        fact = EvidenceFact("ad_spend", "ads.search", "provider", p, p, p, 0, "CAD", FreshnessState.FRESH, MeasurementStatus.UNAVAILABLE, "spend", 0.5)
        with self.assertRaises(ValueError):
            fact.validate()

    def test_zero_is_valid_measured_value(self) -> None:
        world = SyntheticWorld()
        p = Period(date(2026, 9, 1), date(2026, 9, 1), "one day")
        fact = replace(world.fact("ad_spend", "ads.search", "provider", p, currency="CAD"), value=0)
        fact.validate()
        self.assertEqual(fact.value, 0)

    def test_metric_authority_distinguishes_revenue_types(self) -> None:
        registry = MetricRegistry()
        self.assertEqual(registry.authoritative_source("total_sales"), "commerce")
        self.assertEqual(registry.authoritative_source("analytics_revenue"), "analytics")
        self.assertEqual(registry.authoritative_source("platform_attributed_revenue", "ads.paid_social"), "ads.paid_social")
        self.assertFalse(registry.silently_equivalent("total_sales", "net_sales"))
        self.assertFalse(registry.silently_equivalent("total_sales", "platform_attributed_revenue"))

    def test_world_commerce_reconciles_channels(self) -> None:
        world = SyntheticWorld()
        p = Period(date(2026, 9, 1), date(2026, 9, 3), "three days")
        total = world.fact("total_sales", "commerce", "all_channels", p, currency="CAD")
        components = world.breakdown(p)
        self.assertEqual(total.value, sum(float(f.value) for f in components))

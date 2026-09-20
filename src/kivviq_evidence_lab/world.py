from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Iterable

from .model import EvidenceFact, FreshnessState, MeasurementStatus, Period
from .registry import MetricRegistry

AD_PROVIDERS = ("ads.search", "ads.paid_social", "ads.visual_social")


class SyntheticWorld:
    """Deterministic synthetic ecommerce evidence world. No external I/O."""

    def __init__(self, seed: int = 20260920) -> None:
        self.seed = seed
        self.registry = MetricRegistry()
        self.provider_state: dict[str, MeasurementStatus] = {
            "commerce": MeasurementStatus.MEASURED,
            "analytics": MeasurementStatus.MEASURED,
            "ads.search": MeasurementStatus.MEASURED,
            "ads.paid_social": MeasurementStatus.MEASURED,
            "ads.visual_social": MeasurementStatus.MEASURED,
            "lifecycle": MeasurementStatus.MEASURED,
            "first_party": MeasurementStatus.MEASURED,
            "cost": MeasurementStatus.MEASURED,
        }
        self.stale_sources: set[str] = set()

    def clone(self) -> "SyntheticWorld":
        other = SyntheticWorld(self.seed)
        other.provider_state = dict(self.provider_state)
        other.stale_sources = set(self.stale_sources)
        return other

    def fail_provider(self, source: str) -> None:
        self.provider_state[source] = MeasurementStatus.UNAVAILABLE

    def degrade_provider(self, source: str) -> None:
        self.provider_state[source] = MeasurementStatus.DEGRADED

    def mark_stale(self, source: str) -> None:
        self.stale_sources.add(source)

    def _stable_unit(self, *parts: object) -> float:
        payload = "|".join(map(str, (self.seed,) + parts)).encode()
        n = int(sha256(payload).hexdigest()[:12], 16)
        return (n % 10000) / 10000

    def _value(self, metric_id: str, source: str, scope: str, period: Period) -> float | int | list[str]:
        days = period.days
        commerce_daily = {
            "gross_sales": 4000.0,
            "discounts": 250.0,
            "refunds": 150.0,
            "net_sales": 3600.0,
            "taxes": 500.0,
            "shipping_revenue": 100.0,
            "total_sales": 4200.0,
            "orders": 10,
            "aov": 420.0,
        }
        if source == "commerce" and metric_id in commerce_daily:
            if metric_id == "aov":
                return 420.0
            if metric_id == "total_sales" and scope != "all_channels":
                shares = {"online": 2600.0, "pos": 1000.0, "draft": 400.0, "other": 200.0}
                return shares[scope] * days
            return commerce_daily[metric_id] * days

        provider_rates = {
            "ads.search": {"ad_spend": 220.0, "ad_impressions": 18000, "ad_clicks": 540, "attributed_purchases": 7, "platform_attributed_revenue": 3600.0},
            "ads.paid_social": {"ad_spend": 300.0, "ad_impressions": 30000, "ad_clicks": 600, "attributed_purchases": 8, "platform_attributed_revenue": 4200.0},
            "ads.visual_social": {"ad_spend": 80.0, "ad_impressions": 9000, "ad_clicks": 210, "attributed_purchases": 2, "platform_attributed_revenue": 900.0},
        }
        if source in provider_rates and metric_id in provider_rates[source]:
            return provider_rates[source][metric_id] * days

        analytics = {"analytics_sessions": 850, "analytics_revenue": 3350.0}
        if source == "analytics" and metric_id in analytics:
            return analytics[metric_id] * days

        lifecycle = {"lifecycle_sends": 1500, "lifecycle_attributed_revenue": 700.0, "subscriber_growth": 18}
        if source == "lifecycle" and metric_id in lifecycle:
            return lifecycle[metric_id] * days

        if source == "first_party":
            if metric_id == "first_party_linked_revenue":
                return 2800.0 * days
            if metric_id == "ordered_journey":
                return ["paid_social", "direct", "purchase"]

        if source == "cost":
            revenue = 4200.0 * days
            cogs = 2100.0 * days
            ad_spend = 600.0 * days
            variable = 250.0 * days
            if metric_id == "cogs":
                return cogs
            if metric_id == "gross_profit":
                return revenue - cogs
            if metric_id == "gross_margin":
                return (revenue - cogs) / revenue
            if metric_id == "contribution":
                return revenue - cogs - ad_spend - variable
            if metric_id == "net_profit":
                return revenue - cogs - ad_spend - variable - 600.0 * days

        # Deterministic fallback for supported generic numeric metrics.
        return round((100 + 900 * self._stable_unit(metric_id, source, scope, period.start, period.end)) * days, 2)

    def fact(
        self,
        metric_id: str,
        source: str,
        scope: str,
        period: Period,
        *,
        currency: str | None = None,
        breakdown_dimension: str | None = None,
        attribution_basis: str | None = None,
        profit_basis: str | None = None,
        supports_ordered_journey: bool = False,
        supports_causality: bool = False,
        coverage: float = 1.0,
    ) -> EvidenceFact:
        state = self.provider_state.get(source, MeasurementStatus.UNAVAILABLE)
        fresh = FreshnessState.STALE if source in self.stale_sources else FreshnessState.FRESH
        value = None if state is MeasurementStatus.UNAVAILABLE else self._value(metric_id, source, scope, period)
        definition = self.registry.get(metric_id).definition if self.registry.contains(metric_id) else metric_id
        return EvidenceFact(
            metric_id=metric_id,
            source=source,
            scope=scope,
            period=period,
            requested_range=period,
            served_range=period,
            value=value,
            currency=currency,
            freshness=fresh,
            measurement_status=state,
            definition=definition,
            confidence=0.99 if state is MeasurementStatus.MEASURED else 0.6,
            quality={"synthetic": True, "seed": self.seed, "provider_state": state.value, "cost_inputs": ["cogs", "ad_spend", "shipping_cost", "payment_fees", "overhead"] if source == "cost" else []},
            breakdown_dimension=breakdown_dimension,
            attribution_basis=attribution_basis,
            profit_basis=profit_basis,
            supports_ordered_journey=supports_ordered_journey,
            supports_causality=supports_causality,
            coverage=coverage,
            observed_at=datetime.now(timezone.utc),
        )

    def breakdown(self, period: Period) -> tuple[EvidenceFact, ...]:
        return tuple(self.fact("total_sales", "commerce", scope, period, currency="CAD", breakdown_dimension="sales_channel") for scope in ("online", "pos", "draft", "other"))

    def advertising_bundle(self, metric_id: str, period: Period) -> tuple[EvidenceFact, ...]:
        return tuple(self.fact(metric_id, provider, "provider", period, currency="CAD" if metric_id in {"ad_spend", "platform_attributed_revenue"} else None, attribution_basis="provider_reported" if metric_id == "platform_attributed_revenue" else None) for provider in AD_PROVIDERS)

    @staticmethod
    def replace_fact(fact: EvidenceFact, **changes: Any) -> EvidenceFact:
        return replace(fact, **changes)


def ensure_valid(facts: Iterable[EvidenceFact]) -> None:
    for fact in facts:
        fact.validate()

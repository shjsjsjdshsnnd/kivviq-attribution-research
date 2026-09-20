from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MetricDefinition:
    metric_id: str
    authoritative_source: str
    definition: str
    semantic_family: str
    currency: bool = False


class MetricRegistry:
    def __init__(self) -> None:
        definitions = [
            MetricDefinition("gross_sales", "commerce", "Sales before discounts and refunds.", "store_revenue", True),
            MetricDefinition("net_sales", "commerce", "Gross sales less discounts and refunds.", "store_revenue", True),
            MetricDefinition("total_sales", "commerce", "Net sales plus taxes and shipping.", "store_revenue", True),
            MetricDefinition("orders", "commerce", "Commerce orders.", "store_orders"),
            MetricDefinition("aov", "commerce", "Total sales divided by commerce orders.", "store_orders", True),
            MetricDefinition("refunds", "commerce", "Refunded merchandise value.", "store_revenue", True),
            MetricDefinition("discounts", "commerce", "Discount value.", "store_revenue", True),
            MetricDefinition("taxes", "commerce", "Taxes collected.", "store_revenue", True),
            MetricDefinition("shipping_revenue", "commerce", "Shipping charged to customers.", "store_revenue", True),
            MetricDefinition("analytics_sessions", "analytics", "Sessions reported by the analytics platform.", "analytics"),
            MetricDefinition("analytics_revenue", "analytics", "Revenue reported by analytics measurement.", "analytics", True),
            MetricDefinition("ad_spend", "requested_provider", "Spend reported by the requested advertising provider.", "advertising", True),
            MetricDefinition("ad_impressions", "requested_provider", "Impressions reported by the requested advertising provider.", "advertising"),
            MetricDefinition("ad_clicks", "requested_provider", "Clicks reported by the requested advertising provider.", "advertising"),
            MetricDefinition("attributed_purchases", "requested_provider", "Purchases attributed by the requested ad provider.", "advertising"),
            MetricDefinition("platform_attributed_revenue", "requested_provider", "Revenue attributed by an ad provider under its own rules.", "attribution", True),
            MetricDefinition("lifecycle_sends", "lifecycle", "Messages sent by the lifecycle provider.", "lifecycle"),
            MetricDefinition("lifecycle_attributed_revenue", "lifecycle", "Revenue attributed by the lifecycle provider.", "lifecycle", True),
            MetricDefinition("subscriber_growth", "lifecycle", "Net subscriber growth.", "lifecycle"),
            MetricDefinition("first_party_linked_revenue", "first_party", "Revenue linked to observed first-party journeys.", "attribution", True),
            MetricDefinition("ordered_journey", "first_party", "Observed ordered touchpoint sequence.", "journey"),
            MetricDefinition("cogs", "cost", "Cost of goods sold.", "profit", True),
            MetricDefinition("gross_profit", "cost", "Revenue less COGS.", "profit", True),
            MetricDefinition("gross_margin", "cost", "Gross profit divided by revenue.", "profit"),
            MetricDefinition("contribution", "cost", "Revenue less COGS, advertising and known variable costs.", "profit", True),
            MetricDefinition("net_profit", "cost", "Contribution less overhead and other complete operating costs.", "profit", True),
        ]
        self._definitions = {d.metric_id: d for d in definitions}

    def get(self, metric_id: str) -> MetricDefinition:
        return self._definitions[metric_id]

    def authoritative_source(self, metric_id: str, requested_provider: str | None = None) -> str | None:
        d = self.get(metric_id)
        return requested_provider if d.authoritative_source == "requested_provider" else d.authoritative_source

    def contains(self, metric_id: str) -> bool:
        return metric_id in self._definitions

    @property
    def metric_ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._definitions))

    @staticmethod
    def silently_equivalent(metric_a: str, metric_b: str) -> bool:
        return metric_a == metric_b

from __future__ import annotations

import re
from datetime import datetime

from .model import RequestSemantics
from .periods import resolve_period

PROVIDER_ALIASES = {
    "google": "ads.search",
    "google ads": "ads.search",
    "search ads": "ads.search",
    "meta": "ads.paid_social",
    "facebook": "ads.paid_social",
    "instagram": "ads.paid_social",
    "paid social": "ads.paid_social",
    "pinterest": "ads.visual_social",
    "visual social": "ads.visual_social",
}


class SemanticResolver:
    def resolve(self, question: str, reference: datetime | None = None, context: RequestSemantics | None = None) -> RequestSemantics:
        q = " ".join(question.lower().strip().split())
        period = resolve_period(q, reference)
        freshness = "fresh" if any(term in q for term in ("current", "today", "latest", "right now", "last 7 days")) else None
        provider = next((value for alias, value in sorted(PROVIDER_ALIASES.items(), key=lambda kv: -len(kv[0])) if alias in q), None)

        # Follow-up shorthand can inherit only explicit context fields.
        if context and re.fullmatch(r"(?:and )?(?:what about|how about) (?:that|it|them)\??", q):
            return RequestSemantics(
                intent=context.intent,
                metric=context.metric,
                source_provider=context.source_provider,
                scope=context.scope,
                breakdown_dimension=context.breakdown_dimension,
                period=period,
                comparison_period=context.comparison_period,
                currency=context.currency,
                aggregation=context.aggregation,
                attribution_basis=context.attribution_basis,
                profit_basis=context.profit_basis,
                journey_requirement=context.journey_requirement,
                freshness_requirement=freshness or context.freshness_requirement,
            )

        if q in {"how is it doing?", "how much did that make?", "what about that?", "what is the number?", "how are things?"}:
            return RequestSemantics("unknown", None, None, "ambiguous", None, period, ambiguous_reasons=("insufficient referent",))

        # Explicit comparisons are structured, not treated as ambiguity.
        if "compare" in q and ("revenue" in q or "sales" in q):
            if "online" in q and re.search(r"\bpos\b", q):
                return RequestSemantics("comparison", "total_sales", "commerce", "all_channels", "sales_channel", period, freshness_requirement=freshness)
            if "last 30 days" in q and "previous 30 days" in q:
                return RequestSemantics(
                    "comparison", "total_sales", "commerce", "all_channels", None,
                    resolve_period("last 30 days", reference),
                    comparison_period=resolve_period("previous 30 days", reference),
                    freshness_requirement=freshness,
                )

        causal = any(term in q for term in ("cause", "caused", "actually created", "without the ads", "incremental", "incrementality"))
        if causal:
            return RequestSemantics("causal_question", None, provider, "all_channels", None, period, attribution_basis="causal", freshness_requirement=freshness)

        if any(term in q for term in ("what did buyers do before purchasing", "customer journey", "journey before", "path to purchase", "sequence before purchase")):
            return RequestSemantics("journey", "ordered_journey", "first_party", "purchasers", None, period, journey_requirement="ordered_events", freshness_requirement=freshness)

        if any(term in q for term in ("net profit", "bottom line profit")):
            return RequestSemantics("profitability", "net_profit", "cost", "all_channels", None, period, profit_basis="net", freshness_requirement=freshness)
        if any(term in q for term in ("contribution", "contribution profit")):
            return RequestSemantics("profitability", "contribution", "cost", "all_channels", None, period, profit_basis="contribution", freshness_requirement=freshness)
        if any(term in q for term in ("gross profit", "gross margin")):
            metric = "gross_margin" if "margin" in q else "gross_profit"
            return RequestSemantics("profitability", metric, "cost", "all_channels", None, period, profit_basis="gross", freshness_requirement=freshness)
        if "profitable" in q or "profitability" in q:
            return RequestSemantics("profitability", "contribution", "cost", "all_channels", None, period, profit_basis="contribution", freshness_requirement=freshness)

        if "session" in q:
            return RequestSemantics("metric", "analytics_sessions", "analytics", "all_traffic", None, period, freshness_requirement=freshness)

        if any(term in q for term in ("email", "sms", "lifecycle")):
            metric = "lifecycle_attributed_revenue" if "revenue" in q or "perform" in q else "lifecycle_sends"
            return RequestSemantics("metric", metric, "lifecycle", "all_messages", None, period, attribution_basis="provider_reported" if "attributed" in metric else None, freshness_requirement=freshness)

        if any(term in q for term in ("spend", "spent")):
            if provider:
                return RequestSemantics("metric", "ad_spend", provider, "provider", None, period, freshness_requirement=freshness)
            if any(term in q for term in ("paid social", "advertising", "ads", "ad platforms", "platforms")):
                scope = "all_ad_providers" if any(term in q for term in ("advertising", "ads", "ad platforms", "platforms")) and "paid social" not in q else "provider"
                return RequestSemantics("metric", "ad_spend", provider, scope, "provider" if scope == "all_ad_providers" else None, period, freshness_requirement=freshness)

        if provider and any(term in q for term in ("attributed revenue", "attribute", "roas", "doing", "performing")):
            return RequestSemantics("metric", "platform_attributed_revenue", provider, "provider", None, period, attribution_basis="provider_reported", freshness_requirement=freshness)

        # Store revenue and sales semantics. Breakdown is explicit, not ambiguity.
        if any(term in q for term in ("revenue", "sales", "make", "made")):
            metric = "total_sales"
            if "gross" in q:
                metric = "gross_sales"
            elif "net" in q:
                metric = "net_sales"
            scope = "all_channels"
            if any(term in q for term in ("online", "online store", "website", "web store")):
                scope = "online"
            elif re.search(r"\bpos\b", q) or "retail store" in q or "physical store" in q:
                scope = "pos"
            elif "draft" in q:
                scope = "draft"
            elif "other channel" in q:
                scope = "other"
            breakdown = "sales_channel" if any(term in q for term in ("breakdown", "by channel", "split by channel", "across channels")) else None
            if breakdown:
                scope = "all_channels"
            return RequestSemantics("metric", metric, "commerce", scope, breakdown, period, freshness_requirement=freshness)

        if any(term in q for term in ("orders", "order count")):
            return RequestSemantics("metric", "orders", "commerce", "all_channels", None, period, freshness_requirement=freshness)

        return RequestSemantics("unknown", None, None, "ambiguous", None, period, ambiguous_reasons=("metric unresolved",))

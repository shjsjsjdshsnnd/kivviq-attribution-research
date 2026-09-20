from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

from .benchmark import REFERENCE, _facts_and_answer
from .contracts import contract_for_request
from .governor import EvidenceGovernor
from .model import (
    ExpectedOutcome,
    FailureClass,
    FreshnessState,
    MeasurementStatus,
    Period,
    ProposedAnswer,
    RequestSemantics,
)
from .periods import resolve_period
from .registry import MetricRegistry
from .world import SyntheticWorld


def _revenue_request() -> RequestSemantics:
    p = resolve_period("last 30 days", REFERENCE)
    return RequestSemantics("metric", "total_sales", "commerce", "all_channels", None, p)


def _spend_request() -> RequestSemantics:
    p = resolve_period("last 7 days", REFERENCE)
    return RequestSemantics("metric", "ad_spend", "ads.paid_social", "provider", None, p, freshness_requirement="fresh")


def run_mutation_suite() -> dict[str, object]:
    registry = MetricRegistry()
    governor = EvidenceGovernor()
    world = SyntheticWorld()
    rows: list[dict[str, object]] = []

    # 1. False ambiguity.
    expected = _revenue_request()
    mutated = replace(expected, metric=None, scope="ambiguous", ambiguous_reasons=("forced ambiguity",))
    rows.append({"name": "false_ambiguity", "detected": mutated != expected, "failure": FailureClass.SEMANTIC_FALSE_AMBIGUITY.value})

    # 2. Exact spend replaced by null then presented as zero.
    req = _spend_request()
    contract = contract_for_request(req, registry)
    base = _facts_and_answer(req, world)
    null_fact = replace(base.evidence[0], value=None, measurement_status=MeasurementStatus.NULL)
    answer = replace(base, value=0, evidence=(null_fact,))
    result = governor.validate(answer, contract)
    rows.append({"name": "null_as_zero", "detected": not result.supported and FailureClass.NULL_AS_ZERO in result.failures, "failure": FailureClass.NULL_AS_ZERO.value})

    # 3. Unavailable provider replaced with zero.
    unavailable = replace(base.evidence[0], value=0, measurement_status=MeasurementStatus.UNAVAILABLE)
    answer = replace(base, value=0, evidence=(unavailable,))
    result = governor.validate(answer, contract)
    rows.append({"name": "unavailable_as_zero", "detected": not result.supported and FailureClass.NULL_AS_ZERO in result.failures, "failure": FailureClass.NULL_AS_ZERO.value})

    # 4. Served range shifted by one day.
    p = req.period
    assert p is not None
    shifted = Period(p.start + timedelta(days=1), p.end + timedelta(days=1), "shifted")
    wrong_fact = replace(base.evidence[0], served_range=shifted, period=shifted)
    answer = replace(base, period=shifted, evidence=(wrong_fact,))
    result = governor.validate(answer, contract)
    rows.append({"name": "date_shift", "detected": not result.supported and FailureClass.WRONG_PERIOD in result.failures, "failure": FailureClass.WRONG_PERIOD.value})

    # 5. Total sales silently swapped for net sales.
    req = _revenue_request()
    contract = contract_for_request(req, registry)
    net_fact = world.fact("net_sales", "commerce", "all_channels", req.period, currency="CAD")  # type: ignore[arg-type]
    answer = ProposedAnswer("net_sales", "commerce", "all_channels", req.period, net_fact.value, (net_fact,))
    result = governor.validate(answer, contract)
    rows.append({"name": "gross_net_total_swap", "detected": not result.supported and FailureClass.GROSS_NET_TOTAL_CONFUSION in result.failures, "failure": FailureClass.GROSS_NET_TOTAL_CONFUSION.value})

    # 6. Platform-attributed revenue substituted for store revenue.
    attributed = world.fact("platform_attributed_revenue", "ads.paid_social", "provider", req.period, currency="CAD", attribution_basis="provider_reported")  # type: ignore[arg-type]
    answer = ProposedAnswer("platform_attributed_revenue", "ads.paid_social", "all_channels", req.period, attributed.value, (attributed,))
    result = governor.validate(answer, contract)
    rows.append({"name": "attributed_as_store_revenue", "detected": not result.supported and FailureClass.ATTRIBUTED_AS_STORE_REVENUE in result.failures, "failure": FailureClass.ATTRIBUTED_AS_STORE_REVENUE.value})

    # 7. One provider silently dropped from a cross-platform total.
    p = resolve_period("last 7 days", REFERENCE)
    req = RequestSemantics("metric", "ad_spend", None, "all_ad_providers", "provider", p, freshness_requirement="fresh")
    contract = contract_for_request(req, registry)
    all_facts = world.advertising_bundle("ad_spend", p)
    kept = all_facts[1:]
    answer = ProposedAnswer("ad_spend", "multi_provider", "all_ad_providers", p, sum(float(f.value) for f in kept if f.value is not None), kept, breakdown_dimension="provider", calculation="sum")
    result = governor.validate(answer, contract)
    rows.append({"name": "provider_dropped", "detected": result.outcome is ExpectedOutcome.SOURCE_DEGRADED, "failure": FailureClass.PROVIDER_FAILURE_CONTAMINATION.value})

    # 8. Freshness metadata removed from a current request.
    req = _spend_request()
    contract = contract_for_request(req, registry)
    base = _facts_and_answer(req, world)
    unknown = replace(base.evidence[0], freshness=FreshnessState.UNKNOWN)
    result = governor.validate(replace(base, evidence=(unknown,)), contract)
    rows.append({"name": "freshness_removed", "detected": not result.supported and FailureClass.STALE_EVIDENCE in result.failures, "failure": FailureClass.STALE_EVIDENCE.value})

    # 9. Aggregate/unsupported data used to fabricate an ordered journey.
    p = resolve_period("last 30 days", REFERENCE)
    req = RequestSemantics("journey", "ordered_journey", "first_party", "purchasers", None, p, journey_requirement="ordered_events")
    contract = contract_for_request(req, registry)
    fact = world.fact("ordered_journey", "first_party", "purchasers", p, supports_ordered_journey=False)
    answer = ProposedAnswer("ordered_journey", "first_party", "purchasers", p, ["paid_social", "direct", "purchase"], (fact,), claims_ordered_journey=True)
    result = governor.validate(answer, contract)
    rows.append({"name": "fabricated_journey", "detected": not result.supported and FailureClass.FABRICATED_JOURNEY in result.failures, "failure": FailureClass.FABRICATED_JOURNEY.value})

    # 10. Profit claim with required variable-cost inputs missing.
    req = RequestSemantics("profitability", "contribution", "cost", "all_channels", None, p, profit_basis="contribution")
    contract = contract_for_request(req, registry)
    fact = world.fact("contribution", "cost", "all_channels", p, currency="CAD", profit_basis="contribution")
    fact = replace(fact, quality={**fact.quality, "cost_inputs": ["cogs", "ad_spend"]})
    answer = ProposedAnswer("contribution", "cost", "all_channels", p, fact.value, (fact,), profit_basis="contribution")
    result = governor.validate(answer, contract)
    rows.append({"name": "missing_profit_inputs", "detected": not result.supported and FailureClass.UNSUPPORTED_PROFIT in result.failures, "failure": FailureClass.UNSUPPORTED_PROFIT.value})

    return {"total": len(rows), "detected": sum(bool(r["detected"]) for r in rows), "results": rows}

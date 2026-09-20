from __future__ import annotations

from .model import AnswerContract, ExpectedOutcome, RequestSemantics
from .registry import MetricRegistry


def contract_for_request(request: RequestSemantics, registry: MetricRegistry) -> AnswerContract:
    if request.is_ambiguous:
        return AnswerContract(ExpectedOutcome.AMBIGUOUS, None, None, None, request.period)
    if request.intent == "causal_question":
        return AnswerContract(
            ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM,
            None,
            request.source_provider,
            request.scope,
            request.period,
            attribution_basis="causal",
            require_causal_support=True,
        )
    assert request.metric is not None
    source = registry.authoritative_source(request.metric, request.source_provider)
    cost_inputs: tuple[str, ...] = ()
    if request.profit_basis == "gross":
        cost_inputs = ("cogs",)
    elif request.profit_basis == "contribution":
        cost_inputs = ("cogs", "ad_spend", "shipping_cost", "payment_fees")
    elif request.profit_basis == "net":
        cost_inputs = ("cogs", "ad_spend", "shipping_cost", "payment_fees", "overhead")
    required_sources = ("ads.search", "ads.paid_social", "ads.visual_social") if request.scope == "all_ad_providers" else ()
    return AnswerContract(
        ExpectedOutcome.SUPPORTED_EXACT,
        request.metric,
        source,
        request.scope,
        request.period,
        breakdown_dimension=request.breakdown_dimension,
        permitted_calculations=("sum", "difference", "ratio") if request.breakdown_dimension else (),
        required_caveats=(),
        require_fresh=request.freshness_requirement == "fresh",
        require_full_coverage=request.scope == "all_ad_providers",
        attribution_basis=request.attribution_basis,
        profit_basis=request.profit_basis,
        require_ordered_journey=request.journey_requirement == "ordered_events",
        require_causal_support=False,
        required_cost_inputs=cost_inputs,
        required_sources=required_sources,
    )

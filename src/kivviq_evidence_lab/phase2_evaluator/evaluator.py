from __future__ import annotations

from collections import Counter
from dataclasses import replace
from typing import cast

from ..contracts import contract_for_request
from ..governor import EvidenceGovernor
from ..model import ExpectedOutcome, ProposedAnswer, RequestSemantics
from ..phase2.contracts import SemanticBundle, SemanticResolverCandidate
from ..registry import MetricRegistry
from ..retrieval import EvidenceRetriever
from ..world import SyntheticWorld
from .holdout_v1 import HoldoutSuite, REFERENCE, build_holdout_v1

FIELDS = (
    "intent",
    "metric",
    "source_provider",
    "scope",
    "period",
    "comparison_period",
    "breakdown_dimension",
    "attribution_basis",
)


def _message_is_ambiguous(bundle: SemanticBundle) -> bool:
    return len(bundle.requests) == 1 and bundle.requests[0].is_ambiguous


def _field_metrics(
    expected: SemanticBundle,
    actual: SemanticBundle,
    hits: Counter[str],
    totals: Counter[str],
) -> None:
    for index, expected_request in enumerate(expected.requests):
        actual_request = actual.requests[index] if index < len(actual.requests) else None
        for field in FIELDS:
            totals[field] += 1
            if actual_request is not None and getattr(actual_request, field) == getattr(expected_request, field):
                hits[field] += 1


def _currency_for(metric: str | None) -> str | None:
    if metric in {
        "gross_sales",
        "net_sales",
        "total_sales",
        "ad_spend",
        "platform_attributed_revenue",
        "lifecycle_attributed_revenue",
        "gross_profit",
        "contribution",
        "net_profit",
    }:
        return "CAD"
    return None


def _governor_result(request: RequestSemantics) -> ExpectedOutcome:
    registry = MetricRegistry()
    governor = EvidenceGovernor()
    contract = contract_for_request(request, registry)
    if request.intent == "causal_question":
        answer = ProposedAnswer(
            request.metric,
            request.source_provider,
            request.scope,
            request.period,
            None,
            (),
            attribution_basis=request.attribution_basis,
            claims_causality=True,
        )
        return governor.validate(answer, contract).outcome

    if request.metric is None or request.period is None:
        return ExpectedOutcome.INSUFFICIENT_EVIDENCE

    world = SyntheticWorld()
    if request.breakdown_dimension == "sales_channel":
        facts = world.breakdown(request.period)
        answer = ProposedAnswer(
            request.metric,
            "commerce",
            "all_channels",
            request.period,
            {fact.scope: fact.value for fact in facts},
            facts,
            breakdown_dimension="sales_channel",
        )
        return governor.validate(answer, contract).outcome

    source = request.source_provider or "commerce"
    fact = world.fact(
        request.metric,
        source,
        request.scope,
        request.period,
        currency=_currency_for(request.metric),
        attribution_basis=request.attribution_basis,
        profit_basis=request.profit_basis,
        supports_ordered_journey=request.journey_requirement == "ordered_events",
    )
    answer = ProposedAnswer(
        request.metric,
        source,
        request.scope,
        request.period,
        fact.value,
        (fact,),
        attribution_basis=request.attribution_basis,
        profit_basis=request.profit_basis,
        claims_ordered_journey=request.journey_requirement == "ordered_events",
    )
    return governor.validate(answer, contract).outcome


def _evaluate_contradiction(kind: str) -> bool:
    world = SyntheticWorld()
    governor = EvidenceGovernor()
    registry = MetricRegistry()
    period = build_holdout_v1().governor_cases[0].request.period
    if period is None:
        raise AssertionError("holdout governor period missing")

    if kind == "same_authority_conflict":
        request = RequestSemantics("metric", "total_sales", "commerce", "all_channels", None, period)
        contract = contract_for_request(request, registry)
        first = world.fact("total_sales", "commerce", "all_channels", period, currency="CAD")
        second = replace(first, value=float(cast(float | int, first.value)) + 500.0)
        answer = ProposedAnswer("total_sales", "commerce", "all_channels", period, first.value, (first, second))
        result = governor.validate(answer, contract)
        return not result.supported

    if kind == "different_definition":
        request = RequestSemantics("metric", "total_sales", "commerce", "all_channels", None, period)
        contract = contract_for_request(request, registry)
        commerce = world.fact("total_sales", "commerce", "all_channels", period, currency="CAD")
        analytics = world.fact("analytics_revenue", "analytics", "all_channels", period, currency="CAD")
        selected = EvidenceRetriever().select(request, (commerce, analytics))
        answer = ProposedAnswer("total_sales", "commerce", "all_channels", period, commerce.value, selected)
        return governor.validate(answer, contract).supported and selected == (commerce,)

    if kind == "unaffected_metric":
        request = RequestSemantics("metric", "orders", "commerce", "all_channels", None, period)
        contract = contract_for_request(request, registry)
        orders = world.fact("orders", "commerce", "all_channels", period)
        answer = ProposedAnswer("orders", "commerce", "all_channels", period, orders.value, (orders,))
        return governor.validate(answer, contract).supported

    raise ValueError(f"unknown contradiction kind: {kind}")


def evaluate_holdout(
    candidate: SemanticResolverCandidate,
    suite: HoldoutSuite | None = None,
) -> dict[str, object]:
    suite = suite or build_holdout_v1()
    exact = 0
    hits: Counter[str] = Counter()
    totals: Counter[str] = Counter()
    categories: Counter[str] = Counter()
    category_passes: Counter[str] = Counter()
    languages: Counter[str] = Counter()
    language_passes: Counter[str] = Counter()
    ambiguity_tp = 0
    ambiguity_fp = 0
    ambiguity_fn = 0
    non_ambiguous_total = 0
    false_ambiguous = 0

    for semantic_case in suite.semantic_cases:
        actual = candidate.resolve(semantic_case.message, REFERENCE)
        passed = actual == semantic_case.expected
        exact += int(passed)
        categories[semantic_case.category] += 1
        category_passes[semantic_case.category] += int(passed)
        languages[semantic_case.language] += 1
        language_passes[semantic_case.language] += int(passed)
        _field_metrics(semantic_case.expected, actual, hits, totals)

        expected_ambiguous = _message_is_ambiguous(semantic_case.expected)
        actual_ambiguous = _message_is_ambiguous(actual)
        if expected_ambiguous and actual_ambiguous:
            ambiguity_tp += 1
        elif not expected_ambiguous and actual_ambiguous:
            ambiguity_fp += 1
        elif expected_ambiguous and not actual_ambiguous:
            ambiguity_fn += 1
        if not expected_ambiguous:
            non_ambiguous_total += 1
            false_ambiguous += int(actual_ambiguous)

    conversation_total = 0
    conversation_passes = 0
    for dialogue in suite.dialogues:
        context: list[RequestSemantics] = []
        for message, expected in zip(dialogue.turns, dialogue.expected, strict=True):
            actual = candidate.resolve(message, REFERENCE, tuple(context))
            conversation_total += 1
            conversation_passes += int(actual == expected)
            context.extend(actual.requests)

    metamorphic_passes = 0
    for metamorphic_case in suite.metamorphic_cases:
        left = candidate.resolve(metamorphic_case.left, REFERENCE)
        right = candidate.resolve(metamorphic_case.right, REFERENCE)
        if metamorphic_case.relation == "invariant":
            passed = left == right
        else:
            if not left.requests or not right.requests:
                passed = False
            else:
                passed = all(
                    getattr(left.requests[0], field) != getattr(right.requests[0], field)
                    for field in metamorphic_case.changed_fields
                )
        metamorphic_passes += int(passed)

    governor_matches = 0
    unsupported_total = 0
    unsupported_supported = 0
    supported_total = 0
    supported_refused = 0
    for governor_case in suite.governor_cases:
        outcome = _governor_result(governor_case.request)
        governor_matches += int(outcome == governor_case.expected_outcome)
        expected_supported = governor_case.expected_outcome.value.startswith("SUPPORTED")
        actual_supported = outcome.value.startswith("SUPPORTED")
        if expected_supported:
            supported_total += 1
            supported_refused += int(not actual_supported)
        else:
            unsupported_total += 1
            unsupported_supported += int(actual_supported)

    contradiction_passes = sum(
        int(_evaluate_contradiction(contradiction_case.kind) == contradiction_case.expected_safe)
        for contradiction_case in suite.contradiction_cases
    )

    ambiguity_precision = ambiguity_tp / (ambiguity_tp + ambiguity_fp) if ambiguity_tp + ambiguity_fp else 1.0
    ambiguity_recall = ambiguity_tp / (ambiguity_tp + ambiguity_fn) if ambiguity_tp + ambiguity_fn else 1.0

    return {
        "candidate": candidate.name,
        "holdout_version": suite.version,
        "holdout_digest": suite.digest,
        "semantic_cases": len(suite.semantic_cases),
        "dialogue_turns": suite.dialogue_turns,
        "metamorphic_cases": len(suite.metamorphic_cases),
        "governor_cases": len(suite.governor_cases),
        "contradiction_cases": len(suite.contradiction_cases),
        "evaluation_units": suite.evaluation_units,
        "exact_semantic_resolution_accuracy": exact / len(suite.semantic_cases),
        "metric_accuracy": hits["metric"] / totals["metric"],
        "provider_accuracy": hits["source_provider"] / totals["source_provider"],
        "scope_accuracy": hits["scope"] / totals["scope"],
        "period_accuracy": hits["period"] / totals["period"],
        "breakdown_accuracy": hits["breakdown_dimension"] / totals["breakdown_dimension"],
        "ambiguity_precision": ambiguity_precision,
        "ambiguity_recall": ambiguity_recall,
        "false_ambiguity_rate": false_ambiguous / non_ambiguous_total if non_ambiguous_total else 0.0,
        "false_certainty_rate": ambiguity_fn / (ambiguity_tp + ambiguity_fn) if ambiguity_tp + ambiguity_fn else 0.0,
        "conversational_context_accuracy": conversation_passes / conversation_total,
        "multilingual_accuracy": (
            sum(language_passes[language] for language in ("fr", "mixed"))
            / sum(languages[language] for language in ("fr", "mixed"))
        ),
        "metamorphic_consistency": metamorphic_passes / len(suite.metamorphic_cases),
        "evidence_governor_acceptance_accuracy": governor_matches / len(suite.governor_cases),
        "unsupported_claim_rate": unsupported_supported / unsupported_total if unsupported_total else 0.0,
        "false_refusal_rate": supported_refused / supported_total if supported_total else 0.0,
        "semantic_false_refusal_rate": false_ambiguous / non_ambiguous_total if non_ambiguous_total else 0.0,
        "contradiction_safety_accuracy": contradiction_passes / len(suite.contradiction_cases),
        "category_accuracy": {
            category: category_passes[category] / count for category, count in sorted(categories.items())
        },
        "language_accuracy": {
            language: language_passes[language] / count for language, count in sorted(languages.items())
        },
        "failure_categories": {
            category: categories[category] - category_passes[category]
            for category in sorted(categories)
            if category_passes[category] != categories[category]
        },
    }

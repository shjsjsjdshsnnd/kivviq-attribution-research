from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, replace
from datetime import datetime
from itertools import product
from typing import Any
from zoneinfo import ZoneInfo

from .contracts import contract_for_request
from .governor import EvidenceGovernor
from .model import (
    AnswerContract,
    ExpectedOutcome,
    FailureClass,
    ProposedAnswer,
    RequestSemantics,
)
from .periods import resolve_period
from .registry import MetricRegistry
from .retrieval import EvidenceRetriever
from .semantics import SemanticResolver
from .world import SyntheticWorld

REFERENCE = datetime(2026, 9, 20, 12, 0, tzinfo=ZoneInfo("America/Toronto"))


@dataclass(frozen=True)
class BenchmarkCase:
    case_id: str
    category: str
    question: str
    expected: RequestSemantics
    contract: AnswerContract
    evidence_mode: str = "normal"


@dataclass(frozen=True)
class CaseResult:
    case_id: str
    category: str
    passed: bool
    semantic_pass: bool
    governor_pass: bool
    expected_outcome: ExpectedOutcome
    actual_outcome: ExpectedOutcome
    failures: tuple[FailureClass, ...]


def _req(question: str, *, metric: str | None, source: str | None, scope: str, breakdown: str | None = None, intent: str = "metric", attribution: str | None = None, profit: str | None = None, journey: str | None = None, ambiguous: tuple[str, ...] = ()) -> RequestSemantics:
    return RequestSemantics(
        intent=intent,
        metric=metric,
        source_provider=source,
        scope=scope,
        breakdown_dimension=breakdown,
        period=resolve_period(question, REFERENCE),
        attribution_basis=attribution,
        profit_basis=profit,
        journey_requirement=journey,
        freshness_requirement="fresh" if any(x in question.lower() for x in ("current", "today", "latest", "right now", "last 7 days")) else None,
        ambiguous_reasons=ambiguous,
    )


def _case(case_id: str, category: str, question: str, expected: RequestSemantics, registry: MetricRegistry, *, mode: str = "normal", outcome: ExpectedOutcome | None = None, full_coverage: bool | None = None) -> BenchmarkCase:
    contract = contract_for_request(expected, registry)
    if outcome is not None:
        contract = replace(contract, outcome=outcome)
    if full_coverage is not None:
        contract = replace(contract, require_full_coverage=full_coverage)
    return BenchmarkCase(case_id, category, question, expected, contract, mode)


def generate_cases() -> tuple[BenchmarkCase, ...]:
    registry = MetricRegistry()
    cases: list[BenchmarkCase] = []
    counter = 0

    def add(category: str, q: str, expected: RequestSemantics, **kwargs: Any) -> None:
        nonlocal counter
        counter += 1
        cases.append(_case(f"B{counter:04d}", category, q, expected, registry, **kwargs))

    periods = ["last 30 days", "last 7 days", "last 7 complete days", "this week", "last week", "month to date", "last month", "yesterday", "today"]
    revenue_phrases = [
        ("What is my revenue {p}?", "total_sales"),
        ("How much did we make {p}?", "total_sales"),
        ("Show total sales {p}.", "total_sales"),
        ("What were gross sales {p}?", "gross_sales"),
        ("What were net sales {p}?", "net_sales"),
    ]
    for template, metric in revenue_phrases:
        for p in periods:
            q = template.format(p=p)
            add("store_revenue", q, _req(q, metric=metric, source="commerce", scope="all_channels"))

    channel_aliases = [("online", "online"), ("online store", "online"), ("website", "online"), ("POS", "pos"), ("retail store", "pos"), ("draft orders", "draft"), ("other channel", "other")]
    for alias, scope in channel_aliases:
        for p in periods[:6]:
            q = f"How much {alias} revenue did we make {p}?"
            add("channel_scope", q, _req(q, metric="total_sales", source="commerce", scope=scope))

    for phrase in ("revenue breakdown", "sales breakdown", "revenue by channel", "sales split by channel", "revenue across channels"):
        for p in periods[:7]:
            q = f"Show the {phrase} {p}."
            add("breakdown", q, _req(q, metric="total_sales", source="commerce", scope="all_channels", breakdown="sales_channel"))

    provider_terms = [("Google Ads", "ads.search"), ("Meta", "ads.paid_social"), ("Pinterest", "ads.visual_social")]
    spend_templates = ["{provider} spend {p}.", "How much did we spend on {provider} {p}?", "Show {provider} ad spend {p}."]
    for (provider, source), template, p in product(provider_terms, spend_templates, periods[:7]):
        q = template.format(provider=provider, p=p)
        add("provider_spend", q, _req(q, metric="ad_spend", source=source, scope="provider"))

    attributed_templates = ["What attributed revenue does {provider} report {p}?", "How is {provider} doing {p}?", "Show {provider} attributed revenue {p}."]
    for (provider, source), template, p in product(provider_terms, attributed_templates, periods[:5]):
        q = template.format(provider=provider, p=p)
        add("provider_attribution", q, _req(q, metric="platform_attributed_revenue", source=source, scope="provider", attribution="provider_reported"))

    for p in periods:
        for q in (f"How many sessions did we get {p}?", f"Show analytics sessions {p}.", f"What were website sessions {p}?"):
            add("analytics", q, _req(q, metric="analytics_sessions", source="analytics", scope="all_traffic"))

    for p in periods[:7]:
        for q in (f"How is email performing {p}?", f"Show email attributed revenue {p}.", f"How many email sends {p}?"):
            metric = "lifecycle_sends" if "sends" in q else "lifecycle_attributed_revenue"
            add("lifecycle", q, _req(q, metric=metric, source="lifecycle", scope="all_messages", attribution="provider_reported" if metric.endswith("revenue") else None))

    profit_phrases = [("Show gross profit {p}.", "gross_profit", "gross"), ("Show gross margin {p}.", "gross_margin", "gross"), ("Show contribution profit {p}.", "contribution", "contribution"), ("Show net profit {p}.", "net_profit", "net")]
    for template, metric, basis in profit_phrases:
        for p in periods[:6]:
            q = template.format(p=p)
            add("profitability", q, _req(q, metric=metric, source="cost", scope="all_channels", intent="profitability", profit=basis))

    for p in periods[:6]:
        for phrase in ("What did buyers do before purchasing", "Show the customer journey", "Show the path to purchase", "What was the sequence before purchase"):
            q = f"{phrase} {p}?"
            add("journey", q, _req(q, metric="ordered_journey", source="first_party", scope="purchasers", intent="journey", journey="ordered_events"))

    causal_questions = [
        "Meta reported attributed revenue. Did Meta cause that revenue {p}?",
        "Which channel actually created the purchase {p}?",
        "Would these customers have purchased without the ads {p}?",
        "What was the incremental effect of ads {p}?",
    ]
    for template in causal_questions:
        for p in periods[:6]:
            q = template.format(p=p)
            source: str | None = "ads.paid_social" if "meta" in q.lower() else None
            add("causality", q, _req(q, metric=None, source=source, scope="all_channels", intent="causal_question", attribution="causal"), outcome=ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM)

    ambiguous = ["How is it doing?", "How much did that make?", "What about that?", "What is the number?", "How are things?"]
    for i in range(30):
        q = ambiguous[i % len(ambiguous)]
        add("ambiguity", q, _req(q, metric=None, source=None, scope="ambiguous", intent="unknown", ambiguous=("insufficient referent",)), outcome=ExpectedOutcome.AMBIGUOUS)

    # Partial provider failure: search ads unavailable must not contaminate paid-social or visual-social facts.
    for _ in range(15):
        q = "Meta spend last 7 days."
        add("partial_provider_failure", q, _req(q, metric="ad_spend", source="ads.paid_social", scope="provider"), mode="search_failed")
        q2 = "Google Ads spend last 7 days."
        add("partial_provider_failure", q2, _req(q2, metric="ad_spend", source="ads.search", scope="provider"), mode="search_failed", outcome=ExpectedOutcome.UNAVAILABLE)
        q3 = "Show advertising spend by platforms last 7 days."
        exp = _req(q3, metric="ad_spend", source=None, scope="all_ad_providers", breakdown="provider")
        add("partial_provider_failure", q3, exp, mode="search_failed", outcome=ExpectedOutcome.SUPPORTED_PARTIAL, full_coverage=False)

    # Freshness rejection: evidence exists but is stale.
    for source_phrase, source in provider_terms:
        for _ in range(10):
            q = f"Show current {source_phrase} spend last 7 days."
            add("freshness", q, _req(q, metric="ad_spend", source=source, scope="provider"), mode="stale", outcome=ExpectedOutcome.STALE)

    # Specific comparison semantics.
    for _ in range(10):
        q = "Compare online and POS revenue last 30 days."
        exp = _req(q, metric="total_sales", source="commerce", scope="all_channels", breakdown="sales_channel", intent="comparison")
        add("comparison", q, exp)
    for _ in range(10):
        q = "Compare revenue last 30 days with previous 30 days."
        exp = RequestSemantics(
            "comparison", "total_sales", "commerce", "all_channels", None,
            resolve_period("last 30 days", REFERENCE),
            comparison_period=resolve_period("previous 30 days", REFERENCE),
        )
        add("comparison", q, exp)

    # Adversarial source precedence: decoy revenue facts are available, but commerce remains authoritative.
    for i in range(30):
        p = periods[i % len(periods)]
        q = f"What is my store revenue {p}?"
        add("evidence_precedence", q, _req(q, metric="total_sales", source="commerce", scope="all_channels"), mode="adversarial")

    # Missing cost inputs must never be treated as zero.
    for i in range(20):
        p = periods[i % 6]
        q = f"Show contribution profit {p}."
        add("missing_cost_inputs", q, _req(q, metric="contribution", source="cost", scope="all_channels", intent="profitability", profit="contribution"), mode="missing_costs", outcome=ExpectedOutcome.INSUFFICIENT_EVIDENCE)

    # Custom date ranges exercise explicit date parsing.
    for i in range(20):
        start_day = 1 + (i % 5)
        end_day = 10 + (i % 5)
        q = f"What is my revenue 2026-08-{start_day:02d} to 2026-08-{end_day:02d}?"
        add("custom_period", q, _req(q, metric="total_sales", source="commerce", scope="all_channels"))

    return tuple(cases)


def _semantic_equal(actual: RequestSemantics, expected: RequestSemantics) -> bool:
    fields = (
        "intent", "metric", "source_provider", "scope", "breakdown_dimension", "period",
        "comparison_period", "attribution_basis", "profit_basis", "journey_requirement",
        "freshness_requirement",
    )
    return all(getattr(actual, f) == getattr(expected, f) for f in fields) and actual.is_ambiguous == expected.is_ambiguous


def _facts_and_answer(request: RequestSemantics, world: SyntheticWorld, mode: str = "normal") -> ProposedAnswer:
    if request.is_ambiguous or request.intent == "causal_question":
        return ProposedAnswer(request.metric, request.source_provider, request.scope, request.period, None, (), claims_causality=request.intent == "causal_question")
    assert request.metric is not None and request.period is not None
    if request.breakdown_dimension == "sales_channel":
        facts = world.breakdown(request.period)
        return ProposedAnswer(request.metric, "commerce", "all_channels", request.period, {f.scope: f.value for f in facts}, facts, breakdown_dimension="sales_channel")
    if request.scope == "all_ad_providers":
        facts = world.advertising_bundle(request.metric, request.period)
        value = sum(float(f.value) for f in facts if isinstance(f.value, (int, float)))
        return ProposedAnswer(request.metric, "multi_provider", request.scope, request.period, value, facts, breakdown_dimension="provider", calculation="sum", caveats=("partial provider coverage",) if any(f.value is None for f in facts) else ())
    source = request.source_provider or "commerce"
    currency = "CAD" if request.metric in {"gross_sales", "net_sales", "total_sales", "ad_spend", "platform_attributed_revenue", "lifecycle_attributed_revenue", "gross_profit", "contribution", "net_profit"} else None
    fact = world.fact(
        request.metric,
        source,
        request.scope,
        request.period,
        currency=currency,
        attribution_basis=request.attribution_basis,
        profit_basis=request.profit_basis,
        supports_ordered_journey=request.journey_requirement == "ordered_events",
    )
    if mode == "missing_costs" and source == "cost":
        fact = world.replace_fact(fact, quality={**fact.quality, "cost_inputs": ["cogs", "ad_spend"]})

    candidates = [fact]
    if mode == "adversarial" and request.metric in {"gross_sales", "net_sales", "total_sales"}:
        candidates.extend([
            world.fact("analytics_revenue", "analytics", "all_channels", request.period, currency="CAD"),
            world.fact("platform_attributed_revenue", "ads.paid_social", "provider", request.period, currency="CAD", attribution_basis="provider_reported"),
            world.fact("first_party_linked_revenue", "first_party", "all_channels", request.period, currency="CAD", attribution_basis="descriptive"),
        ])
    selected = EvidenceRetriever().select(request, candidates)
    return ProposedAnswer(
        request.metric, source, request.scope, request.period, fact.value, selected,
        attribution_basis=request.attribution_basis,
        profit_basis=request.profit_basis,
        claims_ordered_journey=request.journey_requirement == "ordered_events",
    )


def run_case(case: BenchmarkCase) -> CaseResult:
    resolver = SemanticResolver()
    governor = EvidenceGovernor()
    actual = resolver.resolve(case.question, REFERENCE)
    semantic_pass = _semantic_equal(actual, case.expected)

    world = SyntheticWorld()
    if case.evidence_mode == "search_failed":
        world.fail_provider("ads.search")
    if case.evidence_mode == "stale" and case.expected.source_provider:
        world.mark_stale(case.expected.source_provider)

    # Evaluate the expected semantics so evidence validation is independently testable
    # from parsing correctness. Overall case still requires both to pass.
    answer = _facts_and_answer(case.expected, world, case.evidence_mode)
    result = governor.validate(answer, case.contract)
    governor_pass = result.outcome == case.contract.outcome
    failures = result.failures
    if not semantic_pass and not failures:
        failures = (FailureClass.SEMANTIC_FALSE_AMBIGUITY if actual.is_ambiguous and not case.expected.is_ambiguous else FailureClass.WRONG_METRIC,)
    return CaseResult(case.case_id, case.category, semantic_pass and governor_pass, semantic_pass, governor_pass, case.contract.outcome, result.outcome, failures)


def run_benchmark(cases: tuple[BenchmarkCase, ...] | None = None) -> dict[str, object]:
    cases = cases or generate_cases()
    results = [run_case(c) for c in cases]
    category_counts = Counter(r.category for r in results)
    failures = Counter(f.value for r in results if not r.passed for f in r.failures)
    supported_expected = [r for r in results if r.expected_outcome in {ExpectedOutcome.SUPPORTED_EXACT, ExpectedOutcome.SUPPORTED_PARTIAL, ExpectedOutcome.SUPPORTED_ESTIMATE}]
    unsupported_expected = [r for r in results if r.expected_outcome not in {ExpectedOutcome.SUPPORTED_EXACT, ExpectedOutcome.SUPPORTED_PARTIAL, ExpectedOutcome.SUPPORTED_ESTIMATE}]
    false_refusals = sum(1 for r in supported_expected if not r.actual_outcome.value.startswith("SUPPORTED"))
    false_claims = sum(1 for r in unsupported_expected if r.actual_outcome.value.startswith("SUPPORTED"))
    resolver = SemanticResolver()
    actual_semantics = [resolver.resolve(c.question, REFERENCE) for c in cases]
    def field_accuracy(name: str) -> float:
        return sum(1 for a, c in zip(actual_semantics, cases, strict=True) if getattr(a, name) == getattr(c.expected, name)) / len(cases)
    supported_actual = [r for r in results if r.actual_outcome in {ExpectedOutcome.SUPPORTED_EXACT, ExpectedOutcome.SUPPORTED_PARTIAL, ExpectedOutcome.SUPPORTED_ESTIMATE}]
    supported_precision = (
        sum(r.expected_outcome in {ExpectedOutcome.SUPPORTED_EXACT, ExpectedOutcome.SUPPORTED_PARTIAL, ExpectedOutcome.SUPPORTED_ESTIMATE} for r in supported_actual) / len(supported_actual)
        if supported_actual else 1.0
    )
    def category_accuracy(category: str) -> float:
        subset = [r for r in results if r.category == category]
        return sum(r.passed for r in subset) / len(subset) if subset else 1.0
    return {
        "cases": len(results),
        "passed": sum(r.passed for r in results),
        "failed": sum(not r.passed for r in results),
        "categories": dict(sorted(category_counts.items())),
        "intent_resolution_accuracy": field_accuracy("intent"),
        "metric_resolution_accuracy": field_accuracy("metric"),
        "source_authority_accuracy": field_accuracy("source_provider"),
        "scope_accuracy": field_accuracy("scope"),
        "period_accuracy": field_accuracy("period"),
        "breakdown_accuracy": field_accuracy("breakdown_dimension"),
        "semantic_accuracy": sum(r.semantic_pass for r in results) / len(results),
        "governor_accuracy": sum(r.governor_pass for r in results) / len(results),
        "supported_answer_precision": supported_precision,
        "unsupported_answer_refusal_accuracy": 1.0 - (false_claims / len(unsupported_expected) if unsupported_expected else 0.0),
        "false_refusal_rate": false_refusals / len(supported_expected) if supported_expected else 0.0,
        "false_claim_rate": false_claims / len(unsupported_expected) if unsupported_expected else 0.0,
        "partial_failure_isolation_accuracy": category_accuracy("partial_provider_failure"),
        "freshness_compliance": category_accuracy("freshness"),
        "causal_language_compliance": category_accuracy("causality"),
        "journey_evidence_compliance": category_accuracy("journey"),
        "profit_safety_accuracy": min(category_accuracy("profitability"), category_accuracy("missing_cost_inputs")),
        "failure_taxonomy": dict(sorted(failures.items())),
        "results": results,
    }

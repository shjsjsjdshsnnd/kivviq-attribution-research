from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from hashlib import sha256
import json
from zoneinfo import ZoneInfo

from ..model import ExpectedOutcome, Period, RequestSemantics
from ..periods import resolve_period
from ..phase2.contracts import SemanticBundle

HOLDOUT_VERSION = "phase2-holdout-v1.0.0"
REFERENCE = datetime(2026, 9, 20, 12, 0, tzinfo=ZoneInfo("America/Toronto"))


@dataclass(frozen=True)
class SemanticCase:
    case_id: str
    category: str
    language: str
    message: str
    expected: SemanticBundle


@dataclass(frozen=True)
class DialogueCase:
    case_id: str
    language: str
    turns: tuple[str, ...]
    expected: tuple[SemanticBundle, ...]


@dataclass(frozen=True)
class MetamorphicCase:
    case_id: str
    left: str
    right: str
    relation: str
    changed_fields: tuple[str, ...] = ()


@dataclass(frozen=True)
class GovernorCase:
    case_id: str
    request: RequestSemantics
    expected_outcome: ExpectedOutcome


@dataclass(frozen=True)
class ContradictionCase:
    case_id: str
    kind: str
    expected_safe: bool


@dataclass(frozen=True)
class HoldoutSuite:
    version: str
    semantic_cases: tuple[SemanticCase, ...]
    dialogues: tuple[DialogueCase, ...]
    metamorphic_cases: tuple[MetamorphicCase, ...]
    governor_cases: tuple[GovernorCase, ...]
    contradiction_cases: tuple[ContradictionCase, ...]
    digest: str = field(init=False)

    def __post_init__(self) -> None:
        payload = {
            "version": self.version,
            "semantic": [
                (c.case_id, c.category, c.language, c.message, _bundle_payload(c.expected))
                for c in self.semantic_cases
            ],
            "dialogues": [
                (d.case_id, d.language, d.turns, [_bundle_payload(x) for x in d.expected])
                for d in self.dialogues
            ],
            "metamorphic": [
                (m.case_id, m.left, m.right, m.relation, m.changed_fields)
                for m in self.metamorphic_cases
            ],
            "governor": [
                (g.case_id, _request_payload(g.request), g.expected_outcome.value)
                for g in self.governor_cases
            ],
            "contradiction": [
                (c.case_id, c.kind, c.expected_safe) for c in self.contradiction_cases
            ],
        }
        digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        object.__setattr__(self, "digest", digest)

    @property
    def dialogue_turns(self) -> int:
        return sum(len(dialogue.turns) for dialogue in self.dialogues)

    @property
    def evaluation_units(self) -> int:
        return (
            len(self.semantic_cases)
            + self.dialogue_turns
            + len(self.metamorphic_cases)
            + len(self.governor_cases)
            + len(self.contradiction_cases)
        )


def _period(label: str) -> Period:
    return resolve_period(label, REFERENCE)


def _previous_month() -> Period:
    return Period(date(2026, 7, 1), date(2026, 7, 31), "previous month")


def _request(
    period: str,
    *,
    metric: str | None,
    source: str | None,
    scope: str,
    intent: str = "metric",
    breakdown: str | None = None,
    comparison: Period | None = None,
    attribution: str | None = None,
    ambiguous: bool = False,
) -> RequestSemantics:
    return RequestSemantics(
        intent=intent,
        metric=metric,
        source_provider=source,
        scope=scope,
        breakdown_dimension=breakdown,
        period=_period(period),
        comparison_period=comparison,
        attribution_basis=attribution,
        freshness_requirement="fresh" if period in {"last 7 days", "today"} else None,
        ambiguous_reasons=("holdout ambiguity",) if ambiguous else (),
    )


def _bundle(*requests: RequestSemantics) -> SemanticBundle:
    return SemanticBundle(tuple(requests))


def _request_payload(request: RequestSemantics) -> dict[str, object]:
    def period_payload(period: Period | None) -> object:
        if period is None:
            return None
        return (period.start.isoformat(), period.end.isoformat(), period.label)

    return {
        "intent": request.intent,
        "metric": request.metric,
        "provider": request.source_provider,
        "scope": request.scope,
        "breakdown": request.breakdown_dimension,
        "period": period_payload(request.period),
        "comparison": period_payload(request.comparison_period),
        "currency": request.currency,
        "aggregation": request.aggregation,
        "attribution": request.attribution_basis,
        "profit": request.profit_basis,
        "journey": request.journey_requirement,
        "freshness": request.freshness_requirement,
        "ambiguous": request.is_ambiguous,
    }


def _bundle_payload(bundle: SemanticBundle) -> list[dict[str, object]]:
    return [_request_payload(request) for request in bundle.requests]


def build_holdout_v1() -> HoldoutSuite:
    semantic: list[SemanticCase] = []

    def add(category: str, language: str, message: str, *requests: RequestSemantics) -> None:
        semantic.append(
            SemanticCase(
                f"H{len(semantic) + 1:03d}",
                category,
                language,
                message,
                _bundle(*requests),
            )
        )

    periods = ("last 30 days", "last month", "month to date", "last 7 days", "yesterday")
    for template in (
        "Top line for {period}?",
        "What did the business ring up {period}?",
        "Give me the revenue number, {period}.",
        "Money in the door {period}?",
        "Sales total — {period}?",
    ):
        for period in periods:
            message = template.format(period=period)
            add("unseen_paraphrase", "en", message, _request(period, metric="total_sales", source="commerce", scope="all_channels"))

    for provider, source in (("Meta", "ads.paid_social"), ("Google", "ads.search"), ("Pinterest", "ads.visual_social")):
        for period in periods[:4]:
            for template in ("Burn on {provider} {period}?", "{provider} media outlay, {period}?"):
                message = template.format(provider=provider, period=period)
                add("unseen_paraphrase", "en", message, _request(period, metric="ad_spend", source=source, scope="provider"))

    for template in (
        "Where did the sales come from {period}?",
        "Slice revenue by selling channel {period}.",
        "Channel split on revenue {period}.",
        "How is revenue distributed across store channels {period}?",
        "Break the top line out by channel {period}.",
    ):
        for period in periods[:4]:
            message = template.format(period=period)
            add(
                "breakdown",
                "en",
                message,
                _request(period, metric="total_sales", source="commerce", scope="all_channels", breakdown="sales_channel"),
            )

    noisy = (
        ("meta spned lats 30 days", "last 30 days", "ad_spend", "ads.paid_social", "provider", None),
        ("wht revenue last mnth", "last month", "total_sales", "commerce", "all_channels", None),
        ("googl ads cost past 7 dayz", "last 7 days", "ad_spend", "ads.search", "provider", None),
        ("pinterst burn this month", "month to date", "ad_spend", "ads.visual_social", "provider", None),
        ("rev by chanel last month", "last month", "total_sales", "commerce", "all_channels", "sales_channel"),
        ("online salez past 30 days", "last 30 days", "total_sales", "commerce", "online", None),
        ("how much meta we spend last mnth", "last month", "ad_spend", "ads.paid_social", "provider", None),
        ("last 30 revenue pls", "last 30 days", "total_sales", "commerce", "all_channels", None),
        ("need pos sales last mnth", "last month", "total_sales", "commerce", "pos", None),
        ("draft rev past 30d", "last 30 days", "total_sales", "commerce", "draft", None),
        ("metta attributed rev last month", "last month", "platform_attributed_revenue", "ads.paid_social", "provider", None),
        ("goog spend mtd", "month to date", "ad_spend", "ads.search", "provider", None),
        ("sales split channl mtd", "month to date", "total_sales", "commerce", "all_channels", "sales_channel"),
        ("rev yday?", "yesterday", "total_sales", "commerce", "all_channels", None),
        ("pin spend yday", "yesterday", "ad_spend", "ads.visual_social", "provider", None),
    )
    for message, period, metric, source, scope, breakdown in noisy:
        add("noisy_language", "en", message, _request(period, metric=metric, source=source, scope=scope, breakdown=breakdown))

    irrelevant = (
        ("I know traffic was weird, but just give me Meta spend last month.", "last month", "ad_spend", "ads.paid_social", "provider"),
        ("Forget the launch drama — revenue for the last 30 days?", "last 30 days", "total_sales", "commerce", "all_channels"),
        ("Quick one before the meeting: Google spend month to date.", "month to date", "ad_spend", "ads.search", "provider"),
        ("We changed the homepage. What were online sales last month?", "last month", "total_sales", "commerce", "online"),
        ("Not asking about ROAS: just Pinterest spend last 7 days.", "last 7 days", "ad_spend", "ads.visual_social", "provider"),
        ("Ignore email for now; what's total revenue last month?", "last month", "total_sales", "commerce", "all_channels"),
        ("For context we ran a promo. Show sales by channel last month.", "last month", "total_sales", "commerce", "all_channels"),
        ("I'm not worried about traffic. What did the store make yesterday?", "yesterday", "total_sales", "commerce", "all_channels"),
        ("Before we discuss margin, give me Meta spend month to date.", "month to date", "ad_spend", "ads.paid_social", "provider"),
        ("No need for a narrative; Google spend last 30 days.", "last 30 days", "ad_spend", "ads.search", "provider"),
    )
    for message, period, metric, source, scope in irrelevant:
        breakdown = "sales_channel" if "by channel" in message else None
        add("irrelevant_context", "en", message, _request(period, metric=metric, source=source, scope=scope, breakdown=breakdown))

    multi = (
        (
            "Meta spend and Google spend last month.",
            (
                _request("last month", metric="ad_spend", source="ads.paid_social", scope="provider"),
                _request("last month", metric="ad_spend", source="ads.search", scope="provider"),
            ),
        ),
        (
            "Revenue last month and online revenue month to date.",
            (
                _request("last month", metric="total_sales", source="commerce", scope="all_channels"),
                _request("month to date", metric="total_sales", source="commerce", scope="online"),
            ),
        ),
        (
            "Meta spend last month plus Meta attributed revenue last month.",
            (
                _request("last month", metric="ad_spend", source="ads.paid_social", scope="provider"),
                _request("last month", metric="platform_attributed_revenue", source="ads.paid_social", scope="provider", attribution="provider_reported"),
            ),
        ),
        (
            "Revenue by channel last month, and sessions last month.",
            (
                _request("last month", metric="total_sales", source="commerce", scope="all_channels", breakdown="sales_channel"),
                _request("last month", metric="analytics_sessions", source="analytics", scope="all_traffic"),
            ),
        ),
        (
            "Google spend last 7 days; Pinterest spend last 7 days.",
            (
                _request("last 7 days", metric="ad_spend", source="ads.search", scope="provider"),
                _request("last 7 days", metric="ad_spend", source="ads.visual_social", scope="provider"),
            ),
        ),
        (
            "Total sales yesterday and POS sales yesterday.",
            (
                _request("yesterday", metric="total_sales", source="commerce", scope="all_channels"),
                _request("yesterday", metric="total_sales", source="commerce", scope="pos"),
            ),
        ),
        (
            "Online sales last month and draft sales last month.",
            (
                _request("last month", metric="total_sales", source="commerce", scope="online"),
                _request("last month", metric="total_sales", source="commerce", scope="draft"),
            ),
        ),
        (
            "Meta attributed revenue and Meta spend last 30 days.",
            (
                _request("last 30 days", metric="platform_attributed_revenue", source="ads.paid_social", scope="provider", attribution="provider_reported"),
                _request("last 30 days", metric="ad_spend", source="ads.paid_social", scope="provider"),
            ),
        ),
    )
    for message, requests in multi:
        add("multiple_requests", "en", message, *requests)

    for message in (
        "What's working?",
        "How did that do?",
        "What changed?",
        "Is it better?",
        "What's the number?",
        "How are things?",
        "What made money?",
        "Which one is good?",
        "What happened?",
        "And the other one?",
    ):
        add("ambiguity", "en", message, _request("last 30 days", metric=None, source=None, scope="ambiguous", intent="unknown", ambiguous=True))

    french_periods = (
        ("les 30 derniers jours", "last 30 days"),
        ("le mois dernier", "last month"),
        ("ce mois-ci", "month to date"),
    )
    for template in (
        "C'est quoi notre chiffre d'affaires {fr}?",
        "On a fait combien de ventes {fr}?",
        "Donne-moi le total des ventes {fr}.",
        "Combien le commerce a généré {fr}?",
    ):
        for fr, canonical in french_periods:
            message = template.format(fr=fr)
            add("multilingual", "fr", message, _request(canonical, metric="total_sales", source="commerce", scope="all_channels"))

    for provider, source in (("Meta", "ads.paid_social"), ("Google Ads", "ads.search"), ("Pinterest", "ads.visual_social")):
        for fr, canonical in french_periods:
            message = f"Les dépenses {provider}, {fr}, c'était combien?"
            add("multilingual", "fr", message, _request(canonical, metric="ad_spend", source=source, scope="provider"))

    for template in (
        "Ventile le chiffre d'affaires par canal {fr}.",
        "Répartition des ventes par canal {fr}?",
        "D'où viennent nos ventes par canal {fr}?",
    ):
        for fr, canonical in french_periods:
            message = template.format(fr=fr)
            add(
                "multilingual",
                "fr",
                message,
                _request(canonical, metric="total_sales", source="commerce", scope="all_channels", breakdown="sales_channel"),
            )

    for message in (
        "Ça donne quoi?",
        "C'est combien?",
        "Et l'autre?",
        "Qu'est-ce qui marche?",
        "Ça va mieux?",
        "On en est où?",
    ):
        add("ambiguity", "fr", message, _request("last 30 days", metric=None, source=None, scope="ambiguous", intent="unknown", ambiguous=True))

    code_switch = (
        ("What's my chiffre d'affaires this month?", "month to date", "total_sales", "commerce", "all_channels", None),
        ("How much did we spend sur Meta last month?", "last month", "ad_spend", "ads.paid_social", "provider", None),
        ("Ventile our revenue by canal last month.", "last month", "total_sales", "commerce", "all_channels", "sales_channel"),
        ("Google Ads dépenses last 7 days?", "last 7 days", "ad_spend", "ads.search", "provider", None),
        ("Online ventes last month?", "last month", "total_sales", "commerce", "online", None),
        ("Meta attributed chiffre d'affaires last month?", "last month", "platform_attributed_revenue", "ads.paid_social", "provider", None),
        ("Pinterest spend ce mois-ci?", "month to date", "ad_spend", "ads.visual_social", "provider", None),
        ("Revenue split par canal last 30 days.", "last 30 days", "total_sales", "commerce", "all_channels", "sales_channel"),
    )
    for message, period, metric, source, scope, breakdown in code_switch:
        attribution = "provider_reported" if metric == "platform_attributed_revenue" else None
        add("code_switch", "mixed", message, _request(period, metric=metric, source=source, scope=scope, breakdown=breakdown, attribution=attribution))

    for message in (
        "Why did Meta cause our revenue to increase last month?",
        "Since ads drove the increase, why did revenue go up last month?",
        "Explain why Meta created the extra revenue last month.",
        "Why did paid social cause sales to rise last month?",
    ):
        descriptive = _request(
            "last month",
            metric="total_sales",
            source="commerce",
            scope="all_channels",
            intent="comparison",
            comparison=_previous_month(),
        )
        causal = _request(
            "last month",
            metric=None,
            source="ads.paid_social" if "meta" in message.lower() or "paid social" in message.lower() else None,
            scope="all_channels",
            intent="causal_question",
            attribution="causal",
        )
        add("adversarial_premise", "en", message, descriptive, causal)

    if len(semantic) != 160:
        raise AssertionError(f"holdout semantic case count changed: {len(semantic)}")

    lm = _period("last month")
    pm = _previous_month()
    mtd = _period("month to date")
    dialogues = (
        DialogueCase(
            "C001",
            "en",
            (
                "How much did Meta spend last month?",
                "What about Google?",
                "And compared with the month before?",
                "Which changed more?",
            ),
            (
                _bundle(_request("last month", metric="ad_spend", source="ads.paid_social", scope="provider")),
                _bundle(_request("last month", metric="ad_spend", source="ads.search", scope="provider")),
                _bundle(RequestSemantics("comparison", "ad_spend", "ads.search", "provider", None, lm, comparison_period=pm)),
                _bundle(
                    RequestSemantics("comparison", "ad_spend", "ads.paid_social", "provider", None, lm, comparison_period=pm),
                    RequestSemantics("comparison", "ad_spend", "ads.search", "provider", None, lm, comparison_period=pm),
                ),
            ),
        ),
        DialogueCase(
            "C002",
            "en",
            (
                "What's revenue last month?",
                "Online only.",
                "Compare that with POS.",
                "Now month to date.",
            ),
            (
                _bundle(_request("last month", metric="total_sales", source="commerce", scope="all_channels")),
                _bundle(_request("last month", metric="total_sales", source="commerce", scope="online")),
                _bundle(RequestSemantics("comparison", "total_sales", "commerce", "all_channels", "sales_channel", lm)),
                _bundle(RequestSemantics("comparison", "total_sales", "commerce", "all_channels", "sales_channel", mtd)),
            ),
        ),
        DialogueCase(
            "C003",
            "fr",
            (
                "Combien a-t-on dépensé sur Meta le mois dernier?",
                "Et Google?",
                "Compare avec le mois d'avant.",
                "Et Pinterest?",
            ),
            (
                _bundle(_request("last month", metric="ad_spend", source="ads.paid_social", scope="provider")),
                _bundle(_request("last month", metric="ad_spend", source="ads.search", scope="provider")),
                _bundle(RequestSemantics("comparison", "ad_spend", "ads.search", "provider", None, lm, comparison_period=pm)),
                _bundle(RequestSemantics("comparison", "ad_spend", "ads.visual_social", "provider", None, lm, comparison_period=pm)),
            ),
        ),
        DialogueCase(
            "C004",
            "mixed",
            (
                "Meta spend last month?",
                "Et son attributed revenue?",
                "What about Google?",
                "Same comparison month before.",
            ),
            (
                _bundle(_request("last month", metric="ad_spend", source="ads.paid_social", scope="provider")),
                _bundle(_request("last month", metric="platform_attributed_revenue", source="ads.paid_social", scope="provider", attribution="provider_reported")),
                _bundle(_request("last month", metric="platform_attributed_revenue", source="ads.search", scope="provider", attribution="provider_reported")),
                _bundle(RequestSemantics("comparison", "platform_attributed_revenue", "ads.search", "provider", None, lm, comparison_period=pm, attribution_basis="provider_reported")),
            ),
        ),
    )

    metamorphic = (
        MetamorphicCase("M001", "Meta spend last 30 days", "How much have we spent on Meta over the past thirty days?", "invariant"),
        MetamorphicCase("M002", "Google Ads spend last month", "Last month, what was our Google Ads spend?", "invariant"),
        MetamorphicCase("M003", "Revenue last month", "What did the business make last month?", "invariant"),
        MetamorphicCase("M004", "Online revenue last month", "Last month sales from the website?", "invariant"),
        MetamorphicCase("M005", "Revenue by channel last month", "Split last month's sales across channels.", "invariant"),
        MetamorphicCase("M006", "Pinterest spend month to date", "So far this month, Pinterest spend?", "invariant"),
        MetamorphicCase("M007", "Meta spend last 7 days", "What was Meta spend over the last seven days?", "invariant"),
        MetamorphicCase("M008", "Revenue yesterday", "Yesterday's total sales?", "invariant"),
        MetamorphicCase("M009", "Meta spend last month", "meta spend last mnth", "invariant"),
        MetamorphicCase("M010", "Revenue last 30 days", "Top line for the past thirty days?", "invariant"),
        MetamorphicCase("M011", "What's revenue last month?", "C'est quoi le chiffre d'affaires le mois dernier?", "invariant"),
        MetamorphicCase("M012", "Meta spend last month", "Dépenses Meta le mois dernier?", "invariant"),
        MetamorphicCase("M013", "Meta spend last month", "Meta attributed revenue last month", "contrast", ("metric", "attribution_basis")),
        MetamorphicCase("M014", "Revenue last month", "Net sales last month", "contrast", ("metric",)),
        MetamorphicCase("M015", "Online revenue last month", "POS revenue last month", "contrast", ("scope",)),
        MetamorphicCase("M016", "Meta spend last month", "Google Ads spend last month", "contrast", ("source_provider",)),
        MetamorphicCase("M017", "Revenue last month", "Revenue last 30 days", "contrast", ("period",)),
        MetamorphicCase("M018", "Revenue last month", "Revenue by channel last month", "contrast", ("breakdown_dimension",)),
        MetamorphicCase("M019", "Meta attributed revenue last month", "Store revenue last month", "contrast", ("metric", "source_provider")),
        MetamorphicCase("M020", "Meta spend last 7 days", "Meta spend last month", "contrast", ("period",)),
    )

    governor_cases = (
        GovernorCase("G001", _request("last month", metric="total_sales", source="commerce", scope="all_channels"), ExpectedOutcome.SUPPORTED_EXACT),
        GovernorCase("G002", _request("last 7 days", metric="ad_spend", source="ads.paid_social", scope="provider"), ExpectedOutcome.SUPPORTED_EXACT),
        GovernorCase("G003", _request("last month", metric="platform_attributed_revenue", source="ads.search", scope="provider", attribution="provider_reported"), ExpectedOutcome.SUPPORTED_EXACT),
        GovernorCase("G004", _request("last month", metric="total_sales", source="commerce", scope="online"), ExpectedOutcome.SUPPORTED_EXACT),
        GovernorCase("G005", _request("month to date", metric="analytics_sessions", source="analytics", scope="all_traffic"), ExpectedOutcome.SUPPORTED_EXACT),
        GovernorCase("G006", _request("last month", metric="total_sales", source="commerce", scope="all_channels", breakdown="sales_channel"), ExpectedOutcome.SUPPORTED_EXACT),
        GovernorCase("G007", _request("last month", metric=None, source="ads.paid_social", scope="all_channels", intent="causal_question", attribution="causal"), ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM),
        GovernorCase("G008", _request("last 30 days", metric=None, source=None, scope="all_channels", intent="causal_question", attribution="causal"), ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM),
        GovernorCase("G009", _request("last month", metric=None, source="ads.search", scope="all_channels", intent="causal_question", attribution="causal"), ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM),
        GovernorCase("G010", _request("last month", metric=None, source="ads.visual_social", scope="all_channels", intent="causal_question", attribution="causal"), ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM),
        GovernorCase("G011", _request("last 7 days", metric=None, source="ads.paid_social", scope="all_channels", intent="causal_question", attribution="causal"), ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM),
        GovernorCase("G012", _request("yesterday", metric=None, source=None, scope="all_channels", intent="causal_question", attribution="causal"), ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM),
    )

    contradiction_cases = (
        ContradictionCase("X001", "same_authority_conflict", True),
        ContradictionCase("X002", "same_authority_conflict", True),
        ContradictionCase("X003", "different_definition", True),
        ContradictionCase("X004", "different_definition", True),
        ContradictionCase("X005", "unaffected_metric", True),
        ContradictionCase("X006", "unaffected_metric", True),
    )

    return HoldoutSuite(
        HOLDOUT_VERSION,
        tuple(semantic),
        dialogues,
        metamorphic,
        governor_cases,
        contradiction_cases,
    )

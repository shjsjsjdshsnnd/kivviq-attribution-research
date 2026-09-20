from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from ..model import RequestSemantics
from ..periods import resolve_period
from .contracts import SemanticBundle

DEVELOPMENT_VERSION = "phase2-development-v1.0.0"
REFERENCE = datetime(2026, 9, 20, 12, 0, tzinfo=ZoneInfo("America/Toronto"))


@dataclass(frozen=True)
class DevelopmentCase:
    case_id: str
    category: str
    language: str
    message: str
    expected: SemanticBundle


def _request(
    period_text: str,
    *,
    metric: str | None,
    source: str | None,
    scope: str,
    intent: str = "metric",
    breakdown: str | None = None,
    attribution: str | None = None,
    ambiguous: bool = False,
) -> RequestSemantics:
    return RequestSemantics(
        intent=intent,
        metric=metric,
        source_provider=source,
        scope=scope,
        breakdown_dimension=breakdown,
        period=resolve_period(period_text, REFERENCE),
        attribution_basis=attribution,
        ambiguous_reasons=("development ambiguity",) if ambiguous else (),
    )


def generate_development_cases() -> tuple[DevelopmentCase, ...]:
    cases: list[DevelopmentCase] = []

    def add(category: str, language: str, message: str, *requests: RequestSemantics) -> None:
        cases.append(DevelopmentCase(f"D{len(cases) + 1:03d}", category, language, message, SemanticBundle(tuple(requests))))

    periods = ["last 30 days", "last 7 days", "last month", "month to date", "yesterday"]
    for template in (
        "Revenue {period}?",
        "How much did the shop make {period}?",
        "Give me total sales for {period}.",
        "What did we bring in {period}?",
    ):
        for period in periods:
            message = template.format(period=period)
            add("revenue", "en", message, _request(period, metric="total_sales", source="commerce", scope="all_channels"))

    for alias, scope in (("web", "online"), ("store", "pos"), ("draft orders", "draft"), ("other channels", "other")):
        for period in periods[:3]:
            message = f"Sales from {alias} {period}?"
            add("channel_scope", "en", message, _request(period, metric="total_sales", source="commerce", scope=scope))

    for provider, source in (("Google Ads", "ads.search"), ("Meta", "ads.paid_social"), ("Pinterest", "ads.visual_social")):
        for period in periods[:4]:
            message = f"{provider}: what did we spend {period}?"
            add("provider_spend", "en", message, _request(period, metric="ad_spend", source=source, scope="provider"))

    for template in (
        "Break sales out by channel {period}.",
        "Split revenue across sales channels {period}.",
        "Show the channel mix for revenue {period}.",
        "Revenue by sales channel {period}.",
    ):
        for period in periods[:3]:
            message = template.format(period=period)
            add(
                "breakdown",
                "en",
                message,
                _request(period, metric="total_sales", source="commerce", scope="all_channels", breakdown="sales_channel"),
            )

    for message in (
        "How's that doing?",
        "What about it?",
        "What's the figure?",
        "Any better?",
        "And that one?",
        "How much was it?",
        "What happened there?",
        "Is that good?",
    ):
        add("ambiguity", "en", message, _request("last 30 days", metric=None, source=None, scope="ambiguous", intent="unknown", ambiguous=True))

    french_periods = (
        ("les 30 derniers jours", "last 30 days"),
        ("le mois dernier", "last month"),
        ("ce mois-ci", "month to date"),
    )
    for template in (
        "Quel est notre chiffre d'affaires {fr}?",
        "Combien avons-nous vendu {fr}?",
        "Donne-moi les ventes totales {fr}.",
        "On a fait combien en ventes {fr}?",
    ):
        for fr, canonical in french_periods:
            message = template.format(fr=fr)
            add("revenue", "fr", message, _request(canonical, metric="total_sales", source="commerce", scope="all_channels"))

    for provider, source in (("Google Ads", "ads.search"), ("Meta", "ads.paid_social"), ("Pinterest", "ads.visual_social")):
        for fr, canonical in french_periods:
            message = f"Combien a-t-on dépensé sur {provider} {fr}?"
            add("provider_spend", "fr", message, _request(canonical, metric="ad_spend", source=source, scope="provider"))

    code_switch = (
        ("What's our chiffre d'affaires last month?", "last month", "total_sales", "commerce", "all_channels"),
        ("Meta dépenses last 30 days?", "last 30 days", "ad_spend", "ads.paid_social", "provider"),
        ("Show les ventes web month to date.", "month to date", "total_sales", "commerce", "online"),
        ("Google Ads spend ce mois-ci?", "month to date", "ad_spend", "ads.search", "provider"),
        ("Revenue par canal last month.", "last month", "total_sales", "commerce", "all_channels"),
    )
    for message, period, metric, source, scope in code_switch:
        breakdown = "sales_channel" if "par canal" in message else None
        add("code_switch", "mixed", message, _request(period, metric=metric, source=source, scope=scope, breakdown=breakdown))

    typo_cases = (
        ("meta spnd last 30 days", "last 30 days", "ad_spend", "ads.paid_social", "provider"),
        ("whats revnue last month", "last month", "total_sales", "commerce", "all_channels"),
        ("how mch google ads spend lst 7 days", "last 7 days", "ad_spend", "ads.search", "provider"),
        ("revenue brkdown last month", "last month", "total_sales", "commerce", "all_channels"),
        ("pinterest spnd month to date", "month to date", "ad_spend", "ads.visual_social", "provider"),
        ("sales web last 30 day", "last 30 days", "total_sales", "commerce", "online"),
    )
    for message, period, metric, source, scope in typo_cases:
        breakdown = "sales_channel" if "brkdown" in message else None
        add("noisy_language", "en", message, _request(period, metric=metric, source=source, scope=scope, breakdown=breakdown))

    if len(cases) != 96:
        raise AssertionError(f"development suite size changed: {len(cases)}")
    return tuple(cases)

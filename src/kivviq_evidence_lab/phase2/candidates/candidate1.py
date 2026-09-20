from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date, datetime
import json
from typing import Any

from ...model import Period, RequestSemantics
from ..contracts import SemanticBundle, StructuredTextModel
from ..development import generate_development_cases

CANDIDATE_VERSION = "phase2-candidate1-model-semantic-v1.0.0"
PROMPT_VERSION = "phase2-candidate1-prompt-v1.0.0"

_ALLOWED_INTENTS = {
    "metric",
    "comparison",
    "profitability",
    "journey",
    "causal_question",
    "unknown",
}
_ALLOWED_METRICS = {
    None,
    "gross_sales",
    "net_sales",
    "total_sales",
    "orders",
    "aov",
    "refunds",
    "discounts",
    "taxes",
    "shipping_revenue",
    "analytics_sessions",
    "analytics_revenue",
    "ad_spend",
    "ad_impressions",
    "ad_clicks",
    "attributed_purchases",
    "platform_attributed_revenue",
    "lifecycle_sends",
    "lifecycle_attributed_revenue",
    "subscriber_growth",
    "first_party_linked_revenue",
    "ordered_journey",
    "cogs",
    "gross_profit",
    "gross_margin",
    "contribution",
    "net_profit",
}
_ALLOWED_SOURCES = {
    None,
    "commerce",
    "analytics",
    "ads.search",
    "ads.paid_social",
    "ads.visual_social",
    "lifecycle",
    "first_party",
    "cost",
}
_ALLOWED_SCOPES = {
    "all_channels",
    "online",
    "pos",
    "draft",
    "other",
    "provider",
    "all_ad_providers",
    "all_traffic",
    "all_messages",
    "purchasers",
    "ambiguous",
}
_ALLOWED_BREAKDOWNS = {None, "sales_channel", "provider"}
_ALLOWED_ATTRIBUTION = {None, "provider_reported", "descriptive", "causal"}
_ALLOWED_PROFIT = {None, "gross", "contribution", "net"}
_ALLOWED_JOURNEY = {None, "ordered_events"}
_ALLOWED_FRESHNESS = {None, "fresh"}


def _period_payload(period: Period | None) -> object:
    if period is None:
        return None
    return {
        "start": period.start.isoformat(),
        "end": period.end.isoformat(),
        "label": period.label,
    }


def _request_payload(request: RequestSemantics) -> dict[str, object]:
    return {
        "intent": request.intent,
        "metric": request.metric,
        "source_provider": request.source_provider,
        "scope": request.scope,
        "breakdown_dimension": request.breakdown_dimension,
        "period": _period_payload(request.period),
        "comparison_period": _period_payload(request.comparison_period),
        "currency": request.currency,
        "aggregation": request.aggregation,
        "attribution_basis": request.attribution_basis,
        "profit_basis": request.profit_basis,
        "journey_requirement": request.journey_requirement,
        "freshness_requirement": request.freshness_requirement,
        "ambiguous_reasons": list(request.ambiguous_reasons),
    }


def _development_examples() -> list[dict[str, object]]:
    cases = generate_development_cases()
    preferred_ids = ("D001", "D022", "D034", "D047", "D061", "D073", "D085", "D094")
    by_id = {case.case_id: case for case in cases}
    return [
        {
            "message": by_id[case_id].message,
            "requests": [_request_payload(request) for request in by_id[case_id].expected.requests],
        }
        for case_id in preferred_ids
    ]


def _system_prompt() -> str:
    schema: dict[str, object] = {
        "requests": [
            {
                "intent": "allowed intent",
                "metric": "allowed metric or null",
                "source_provider": "allowed source or null",
                "scope": "allowed scope",
                "breakdown_dimension": "sales_channel, provider, or null",
                "period": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "label": "short label"},
                "comparison_period": None,
                "currency": "CAD or null",
                "aggregation": "sum",
                "attribution_basis": None,
                "profit_basis": None,
                "journey_requirement": None,
                "freshness_requirement": None,
                "ambiguous_reasons": [],
            }
        ]
    }
    vocabulary = {
        "intents": sorted(_ALLOWED_INTENTS),
        "metrics": sorted(value for value in _ALLOWED_METRICS if value is not None),
        "sources": sorted(value for value in _ALLOWED_SOURCES if value is not None),
        "scopes": sorted(_ALLOWED_SCOPES),
        "breakdowns": sorted(value for value in _ALLOWED_BREAKDOWNS if value is not None),
        "attribution_basis": sorted(value for value in _ALLOWED_ATTRIBUTION if value is not None),
        "profit_basis": sorted(value for value in _ALLOWED_PROFIT if value is not None),
        "journey_requirement": sorted(value for value in _ALLOWED_JOURNEY if value is not None),
        "freshness_requirement": sorted(value for value in _ALLOWED_FRESHNESS if value is not None),
    }
    return (
        "You are a semantic parser for ecommerce business-intelligence questions. "
        "Interpret language only. Never decide whether a claim is true and never weaken evidence requirements. "
        "Return JSON only, with exactly one top-level key named requests. "
        "Return one request object per materially distinct request in the merchant message. "
        "Preserve obvious merchant intent instead of declaring ambiguity merely because theoretical alternatives exist. "
        "Use ambiguity only when materially different interpretations remain plausible from the message and legitimate context. "
        "For a question with an unsupported causal premise, preserve any valid descriptive/comparison request and also emit a "
        "separate causal_question request; downstream evidence governance decides whether causality is supported. "
        "Use conversation context only when the new turn clearly refers to it; explicit new metric/provider/scope/period terms override context. "
        "Resolve periods using the supplied reference timestamp and output concrete inclusive ISO dates. "
        "Do not invent providers, metrics, evidence, or business facts. "
        f"Allowed vocabulary: {json.dumps(vocabulary, sort_keys=True)}. "
        f"Output shape example: {json.dumps(schema, sort_keys=True)}. "
        f"Candidate-visible development examples: {json.dumps(_development_examples(), sort_keys=True)}."
    )


def _context_payload(context: tuple[RequestSemantics, ...]) -> list[dict[str, object]]:
    return [_request_payload(request) for request in context[-6:]]


def _user_prompt(
    message: str,
    reference: datetime,
    context: tuple[RequestSemantics, ...],
) -> str:
    return json.dumps(
        {
            "reference_timestamp": reference.isoformat(),
            "merchant_message": message,
            "legitimate_context": _context_payload(context),
        },
        sort_keys=True,
    )


def _expect_mapping(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _expect_optional_string(value: object, name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string or null")
    return value


def _period_from_json(value: object, name: str) -> Period | None:
    if value is None:
        return None
    payload = _expect_mapping(value, name)
    start_raw = payload.get("start")
    end_raw = payload.get("end")
    label_raw = payload.get("label")
    if not isinstance(start_raw, str) or not isinstance(end_raw, str) or not isinstance(label_raw, str):
        raise ValueError(f"{name} requires string start/end/label")
    period = Period(date.fromisoformat(start_raw), date.fromisoformat(end_raw), label_raw)
    period.validate()
    return period


def _string_tuple(value: object, name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError(f"{name} must be an array of strings")
    items = tuple(value)
    if not all(isinstance(item, str) for item in items):
        raise ValueError(f"{name} must contain only strings")
    return tuple(str(item) for item in items)


def _parse_request(value: object) -> RequestSemantics:
    payload = _expect_mapping(value, "request")
    intent = _expect_optional_string(payload.get("intent"), "intent")
    metric = _expect_optional_string(payload.get("metric"), "metric")
    source = _expect_optional_string(payload.get("source_provider"), "source_provider")
    scope = _expect_optional_string(payload.get("scope"), "scope")
    breakdown = _expect_optional_string(payload.get("breakdown_dimension"), "breakdown_dimension")
    attribution = _expect_optional_string(payload.get("attribution_basis"), "attribution_basis")
    profit = _expect_optional_string(payload.get("profit_basis"), "profit_basis")
    journey = _expect_optional_string(payload.get("journey_requirement"), "journey_requirement")
    freshness = _expect_optional_string(payload.get("freshness_requirement"), "freshness_requirement")
    currency = _expect_optional_string(payload.get("currency", "CAD"), "currency")
    aggregation = _expect_optional_string(payload.get("aggregation", "sum"), "aggregation")
    ambiguous_reasons = _string_tuple(payload.get("ambiguous_reasons", ()), "ambiguous_reasons")

    if intent not in _ALLOWED_INTENTS:
        raise ValueError(f"unsupported intent: {intent}")
    if metric not in _ALLOWED_METRICS:
        raise ValueError(f"unsupported metric: {metric}")
    if source not in _ALLOWED_SOURCES:
        raise ValueError(f"unsupported source: {source}")
    if scope not in _ALLOWED_SCOPES:
        raise ValueError(f"unsupported scope: {scope}")
    if breakdown not in _ALLOWED_BREAKDOWNS:
        raise ValueError(f"unsupported breakdown: {breakdown}")
    if attribution not in _ALLOWED_ATTRIBUTION:
        raise ValueError(f"unsupported attribution basis: {attribution}")
    if profit not in _ALLOWED_PROFIT:
        raise ValueError(f"unsupported profit basis: {profit}")
    if journey not in _ALLOWED_JOURNEY:
        raise ValueError(f"unsupported journey requirement: {journey}")
    if freshness not in _ALLOWED_FRESHNESS:
        raise ValueError(f"unsupported freshness requirement: {freshness}")
    if aggregation is None:
        raise ValueError("aggregation must not be null")

    return RequestSemantics(
        intent=intent,
        metric=metric,
        source_provider=source,
        scope=scope,
        breakdown_dimension=breakdown,
        period=_period_from_json(payload.get("period"), "period"),
        comparison_period=_period_from_json(payload.get("comparison_period"), "comparison_period"),
        currency=currency,
        aggregation=aggregation,
        attribution_basis=attribution,
        profit_basis=profit,
        journey_requirement=journey,
        freshness_requirement=freshness,
        ambiguous_reasons=ambiguous_reasons,
    )


class Candidate1ModelResolver:
    """Prompt-driven model semantic resolver; downstream evidence authority is unchanged."""

    name = CANDIDATE_VERSION
    prompt_version = PROMPT_VERSION

    def __init__(self, model: StructuredTextModel) -> None:
        self._model = model

    @property
    def model_id(self) -> str:
        return self._model.model_id

    def resolve(
        self,
        message: str,
        reference: datetime,
        context: tuple[RequestSemantics, ...] = (),
    ) -> SemanticBundle:
        raw = self._model.complete(_system_prompt(), _user_prompt(message, reference, context))
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("model returned invalid JSON") from exc
        root = _expect_mapping(payload, "root")
        if set(root) != {"requests"}:
            raise ValueError("model output must contain only the requests key")
        requests_raw = root["requests"]
        if not isinstance(requests_raw, Sequence) or isinstance(requests_raw, (str, bytes)):
            raise ValueError("requests must be an array")
        requests = tuple(_parse_request(item) for item in requests_raw)
        if not requests:
            raise ValueError("model must return at least one request")
        return SemanticBundle(requests)

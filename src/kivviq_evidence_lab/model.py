from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Any


class MeasurementStatus(str, Enum):
    MEASURED = "measured"
    NULL = "null"
    ESTIMATED = "estimated"
    UNAVAILABLE = "unavailable"
    DEGRADED = "degraded"
    NOT_REQUESTED = "not_requested"
    NOT_APPLICABLE = "not_applicable"


class FreshnessState(str, Enum):
    FRESH = "fresh"
    STALE = "stale"
    UNKNOWN = "unknown"


class ExpectedOutcome(str, Enum):
    SUPPORTED_EXACT = "SUPPORTED_EXACT"
    SUPPORTED_PARTIAL = "SUPPORTED_PARTIAL"
    SUPPORTED_ESTIMATE = "SUPPORTED_ESTIMATE"
    AMBIGUOUS = "AMBIGUOUS"
    UNAVAILABLE = "UNAVAILABLE"
    STALE = "STALE"
    SCOPE_MISMATCH = "SCOPE_MISMATCH"
    PERIOD_MISMATCH = "PERIOD_MISMATCH"
    SOURCE_DEGRADED = "SOURCE_DEGRADED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    UNSUPPORTED_CAUSAL_CLAIM = "UNSUPPORTED_CAUSAL_CLAIM"
    CONFLICT = "CONFLICT"


class FailureClass(str, Enum):
    SEMANTIC_FALSE_AMBIGUITY = "SEMANTIC_FALSE_AMBIGUITY"
    WRONG_METRIC = "WRONG_METRIC"
    WRONG_SOURCE = "WRONG_SOURCE"
    WRONG_SCOPE = "WRONG_SCOPE"
    WRONG_BREAKDOWN = "WRONG_BREAKDOWN"
    WRONG_PERIOD = "WRONG_PERIOD"
    STALE_EVIDENCE = "STALE_EVIDENCE"
    NULL_AS_ZERO = "NULL_AS_ZERO"
    PROVIDER_FAILURE_CONTAMINATION = "PROVIDER_FAILURE_CONTAMINATION"
    ATTRIBUTED_AS_STORE_REVENUE = "ATTRIBUTED_AS_STORE_REVENUE"
    GROSS_NET_TOTAL_CONFUSION = "GROSS_NET_TOTAL_CONFUSION"
    UNSUPPORTED_PROFIT = "UNSUPPORTED_PROFIT"
    UNSUPPORTED_CAUSALITY = "UNSUPPORTED_CAUSALITY"
    FABRICATED_JOURNEY = "FABRICATED_JOURNEY"
    UNSUPPORTED_CALCULATION = "UNSUPPORTED_CALCULATION"
    MISSING_CAVEAT = "MISSING_CAVEAT"
    EVIDENCE_AVAILABLE_BUT_REJECTED = "EVIDENCE_AVAILABLE_BUT_REJECTED"
    EVIDENCE_CONFLICT = "EVIDENCE_CONFLICT"


@dataclass(frozen=True)
class Period:
    start: date
    end: date
    label: str

    def validate(self) -> None:
        if self.end < self.start:
            raise ValueError("period end precedes start")

    @property
    def days(self) -> int:
        self.validate()
        return (self.end - self.start).days + 1


@dataclass(frozen=True)
class EvidenceFact:
    metric_id: str
    source: str
    scope: str
    period: Period
    requested_range: Period
    served_range: Period
    value: float | int | str | Sequence[str] | None
    currency: str | None
    freshness: FreshnessState
    measurement_status: MeasurementStatus
    definition: str
    confidence: float
    quality: Mapping[str, Any] = field(default_factory=dict)
    breakdown_dimension: str | None = None
    attribution_basis: str | None = None
    profit_basis: str | None = None
    supports_ordered_journey: bool = False
    supports_causality: bool = False
    coverage: float = 1.0
    observed_at: datetime | None = None

    def validate(self) -> None:
        if not self.metric_id:
            raise ValueError("metric_id is required")
        if not self.source:
            raise ValueError("source is required")
        if not self.scope:
            raise ValueError("scope is required")
        self.period.validate()
        self.requested_range.validate()
        self.served_range.validate()
        if not 0 <= self.confidence <= 1:
            raise ValueError("confidence must be between 0 and 1")
        if not 0 <= self.coverage <= 1:
            raise ValueError("coverage must be between 0 and 1")
        if self.measurement_status is MeasurementStatus.UNAVAILABLE and self.value is not None:
            raise ValueError("unavailable facts must not carry a value")


@dataclass(frozen=True)
class RequestSemantics:
    intent: str
    metric: str | None
    source_provider: str | None
    scope: str
    breakdown_dimension: str | None
    period: Period | None
    comparison_period: Period | None = None
    currency: str | None = "CAD"
    aggregation: str = "sum"
    attribution_basis: str | None = None
    profit_basis: str | None = None
    journey_requirement: str | None = None
    freshness_requirement: str | None = None
    ambiguous_reasons: tuple[str, ...] = ()

    @property
    def is_ambiguous(self) -> bool:
        return bool(self.ambiguous_reasons)


@dataclass(frozen=True)
class AnswerContract:
    outcome: ExpectedOutcome
    required_metric: str | None
    required_source: str | None
    required_scope: str | None
    required_period: Period | None
    breakdown_dimension: str | None = None
    permitted_calculations: tuple[str, ...] = ()
    required_caveats: tuple[str, ...] = ()
    require_fresh: bool = False
    require_full_coverage: bool = True
    attribution_basis: str | None = None
    profit_basis: str | None = None
    require_ordered_journey: bool = False
    require_causal_support: bool = False
    required_cost_inputs: tuple[str, ...] = ()
    required_sources: tuple[str, ...] = ()


@dataclass(frozen=True)
class ProposedAnswer:
    metric_id: str | None
    source: str | None
    scope: str | None
    period: Period | None
    value: Any
    evidence: tuple[EvidenceFact, ...]
    breakdown_dimension: str | None = None
    calculation: str | None = None
    caveats: tuple[str, ...] = ()
    attribution_basis: str | None = None
    profit_basis: str | None = None
    claims_ordered_journey: bool = False
    claims_causality: bool = False


@dataclass(frozen=True)
class EvidenceConflict:
    metric_id: str
    source: str
    scope: str
    period: Period
    values: tuple[Any, ...]
    fact_count: int


@dataclass(frozen=True)
class ValidationResult:
    outcome: ExpectedOutcome
    supported: bool
    failures: tuple[FailureClass, ...] = ()
    notes: tuple[str, ...] = ()
    conflicts: tuple[EvidenceConflict, ...] = ()

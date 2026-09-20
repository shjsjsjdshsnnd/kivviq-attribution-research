from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any


class EstimandKind(StrEnum):
    DESCRIPTIVE_ALLOCATION = "descriptive_allocation"
    AVERAGE_TREATMENT_EFFECT = "average_treatment_effect"
    CONDITIONAL_TREATMENT_EFFECT = "conditional_treatment_effect"
    INCREMENTAL_CONVERSION_PROBABILITY = "incremental_conversion_probability"
    INCREMENTAL_REVENUE = "incremental_revenue"
    TIME_VARYING_TREATMENT_EFFECT = "time_varying_treatment_effect"


@dataclass(frozen=True, slots=True)
class EstimandDefinition:
    kind: EstimandKind
    population: str
    treatment_or_exposure: str
    outcome: str
    horizon_hours: float
    intervention: str
    comparison: str
    unit_of_analysis: str
    temporal_ordering: str
    treatment_regime: str
    aggregation_target: str

    def __post_init__(self) -> None:
        fields = (
            self.population,
            self.treatment_or_exposure,
            self.outcome,
            self.intervention,
            self.comparison,
            self.unit_of_analysis,
            self.temporal_ordering,
            self.treatment_regime,
            self.aggregation_target,
        )
        if any(not value.strip() for value in fields):
            raise ValueError("estimand fields must be explicit and non-empty")
        if self.horizon_hours <= 0 or not math.isfinite(self.horizon_hours):
            raise ValueError("estimand horizon_hours must be finite and positive")


@dataclass(frozen=True, slots=True)
class FamilyCriterion:
    family: str
    metric: str
    operator: str
    threshold: float

    def __post_init__(self) -> None:
        if not self.family.strip() or not self.metric.strip():
            raise ValueError("family criterion requires family and metric")
        if self.operator not in {"lte", "lt", "gte", "gt"}:
            raise ValueError("criterion operator must be lte, lt, gte, or gt")
        if not math.isfinite(self.threshold):
            raise ValueError("criterion threshold must be finite")


@dataclass(frozen=True, slots=True)
class FalsificationCriteria:
    primary_success_criteria: tuple[str, ...]
    failure_criteria: tuple[str, ...]
    uncertainty_requirements: tuple[str, ...]
    robustness_requirements: tuple[str, ...]
    required_holdout_families: tuple[str, ...]
    family_rules: tuple[FamilyCriterion, ...]
    known_unsupported_cases: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.primary_success_criteria or not self.failure_criteria:
            raise ValueError("success and failure criteria must be preregistered")
        if not self.required_holdout_families:
            raise ValueError("at least one holdout family must be preregistered")
        rule_families = {rule.family for rule in self.family_rules}
        missing = set(self.required_holdout_families) - rule_families
        if missing:
            raise ValueError(
                "each required holdout family needs a preregistered machine rule: "
                + ", ".join(sorted(missing))
            )


@dataclass(frozen=True, slots=True)
class CandidateDeclaration:
    candidate_id: str
    version: str
    estimand: EstimandDefinition
    hypothesis: str
    required_observable_inputs: tuple[str, ...]
    assumptions: tuple[str, ...]
    supported_outcome_type: str
    negative_effects_representable: bool
    interactions_representable: bool
    uncertainty_method: str
    hyperparameters: tuple[tuple[str, str], ...]
    hyperparameter_selection_procedure: str
    development_world_usage: tuple[str, ...]
    randomization_behavior: str
    expected_failure_conditions: tuple[str, ...]
    falsification_criteria: FalsificationCriteria

    def __post_init__(self) -> None:
        required = (
            self.candidate_id,
            self.version,
            self.hypothesis,
            self.supported_outcome_type,
            self.uncertainty_method,
            self.hyperparameter_selection_procedure,
            self.randomization_behavior,
        )
        if any(not value.strip() for value in required):
            raise ValueError("candidate declaration fields must be explicit")
        if not self.required_observable_inputs:
            raise ValueError("candidate must declare required observable inputs")
        if not self.assumptions:
            raise ValueError("candidate must declare assumptions")
        if not self.expected_failure_conditions:
            raise ValueError("candidate must declare expected failure conditions")

    @property
    def fingerprint(self) -> str:
        return fingerprint_payload(asdict(self))


@dataclass(frozen=True, slots=True)
class ObservableTouchpoint:
    event_id: str
    timestamp: str
    channel: str
    campaign: str | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    click_id: str | None = None
    referrer: str | None = None


@dataclass(frozen=True, slots=True)
class ObservableSession:
    session_id: str
    start: str
    end: str
    device: str
    touchpoints: tuple[ObservableTouchpoint, ...]


@dataclass(frozen=True, slots=True)
class ObservableConversion:
    conversion_id: str
    timestamp: str
    value: float


@dataclass(frozen=True, slots=True)
class ObservableJourney:
    subject_id: str
    observation_start: str
    observation_end: str
    sessions: tuple[ObservableSession, ...]
    conversion: ObservableConversion | None
    consent_state: str
    identity_confidence: float
    acquisition_evidence: str
    is_censored: bool


@dataclass(frozen=True, slots=True)
class ObservableDataset:
    journeys: tuple[ObservableJourney, ...]
    schema_version: str = "phase2-observable-v1"

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> ObservableDataset:
        journeys: list[ObservableJourney] = []
        for raw_journey in payload.get("journeys", []):
            sessions: list[ObservableSession] = []
            for raw_session in raw_journey.get("sessions", []):
                touches = tuple(
                    ObservableTouchpoint(**raw_touch)
                    for raw_touch in raw_session.get("touchpoints", [])
                )
                sessions.append(
                    ObservableSession(
                        session_id=raw_session["session_id"],
                        start=raw_session["start"],
                        end=raw_session["end"],
                        device=raw_session["device"],
                        touchpoints=touches,
                    )
                )
            raw_conversion = raw_journey.get("conversion")
            conversion = (
                ObservableConversion(**raw_conversion)
                if isinstance(raw_conversion, dict)
                else None
            )
            journeys.append(
                ObservableJourney(
                    subject_id=raw_journey["subject_id"],
                    observation_start=raw_journey["observation_start"],
                    observation_end=raw_journey["observation_end"],
                    sessions=tuple(sessions),
                    conversion=conversion,
                    consent_state=raw_journey["consent_state"],
                    identity_confidence=float(raw_journey["identity_confidence"]),
                    acquisition_evidence=raw_journey["acquisition_evidence"],
                    is_censored=bool(raw_journey["is_censored"]),
                )
            )
        return cls(
            journeys=tuple(journeys),
            schema_version=str(payload.get("schema_version", "phase2-observable-v1")),
        )


@dataclass(frozen=True, slots=True)
class DeclaredContext:
    stage: str
    scenario_family: str
    estimand_fingerprint: str
    phase1_reference: str | None = None
    holdout_version: str | None = None
    protocol_version: str = "phase2-evaluation-v1"

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> DeclaredContext:
        return cls(**payload)


@dataclass(frozen=True, slots=True)
class UncertaintyOutput:
    method: str
    lower: tuple[tuple[str, float], ...]
    upper: tuple[tuple[str, float], ...]
    replications: int | None = None

    def __post_init__(self) -> None:
        if not self.method.strip():
            raise ValueError("uncertainty method must be declared")
        if self.replications is not None and self.replications <= 0:
            raise ValueError("replications must be positive when supplied")


@dataclass(frozen=True, slots=True)
class CandidateResponse:
    estimates: tuple[tuple[str, float], ...]
    uncertainty: UncertaintyOutput | None
    diagnostics: tuple[tuple[str, str], ...] = ()

    @classmethod
    def from_mappings(
        cls,
        estimates: dict[str, float],
        *,
        uncertainty_method: str | None = None,
        lower: dict[str, float] | None = None,
        upper: dict[str, float] | None = None,
        replications: int | None = None,
        diagnostics: dict[str, str] | None = None,
    ) -> CandidateResponse:
        uncertainty = None
        if uncertainty_method is not None:
            uncertainty = UncertaintyOutput(
                method=uncertainty_method,
                lower=tuple(sorted((lower or {}).items())),
                upper=tuple(sorted((upper or {}).items())),
                replications=replications,
            )
        return cls(
            estimates=tuple(sorted(estimates.items())),
            uncertainty=uncertainty,
            diagnostics=tuple(sorted((diagnostics or {}).items())),
        )

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> CandidateResponse:
        raw_uncertainty = payload.get("uncertainty")
        uncertainty = None
        if isinstance(raw_uncertainty, dict):
            uncertainty = UncertaintyOutput(
                method=str(raw_uncertainty["method"]),
                lower=tuple(
                    (str(key), float(value))
                    for key, value in raw_uncertainty.get("lower", [])
                ),
                upper=tuple(
                    (str(key), float(value))
                    for key, value in raw_uncertainty.get("upper", [])
                ),
                replications=(
                    int(raw_uncertainty["replications"])
                    if raw_uncertainty.get("replications") is not None
                    else None
                ),
            )
        return cls(
            estimates=tuple(
                (str(key), float(value)) for key, value in payload.get("estimates", [])
            ),
            uncertainty=uncertainty,
            diagnostics=tuple(
                (str(key), str(value)) for key, value in payload.get("diagnostics", [])
            ),
        )


def fingerprint_payload(payload: Any) -> str:
    canonical = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_candidate_response(response: CandidateResponse) -> None:
    estimate_keys: set[str] = set()
    estimates = dict(response.estimates)
    for key, value in response.estimates:
        if not key.strip() or key in estimate_keys:
            raise ValueError("estimate keys must be unique and non-empty")
        estimate_keys.add(key)
        if not math.isfinite(value):
            raise ValueError("candidate estimates must be finite")

    if response.uncertainty is None:
        return

    lower = dict(response.uncertainty.lower)
    upper = dict(response.uncertainty.upper)
    if set(lower) != set(estimates) or set(upper) != set(estimates):
        raise ValueError("uncertainty bounds must cover every estimate exactly")
    for key, estimate in estimates.items():
        low = lower[key]
        high = upper[key]
        if not all(math.isfinite(value) for value in (low, high)):
            raise ValueError("uncertainty bounds must be finite")
        if low > estimate or estimate > high:
            raise ValueError("uncertainty bounds must contain the estimate")

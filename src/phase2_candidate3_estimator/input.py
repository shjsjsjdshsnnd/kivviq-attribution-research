from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from phase2_candidate3_contracts.contracts import (
    FeatureObservation,
    PretreatmentXContract,
    TreatmentOpportunity,
    validate_feature_observation,
)


@dataclass(frozen=True, slots=True)
class Candidate3FeatureValue:
    feature_name: str
    values: tuple[float, ...]
    source_event_times: tuple[datetime, ...] = ()
    baseline_available_before_decision: bool = False

    def __post_init__(self) -> None:
        if not self.values:
            raise ValueError("feature value vector must not be empty")
        if not all(math.isfinite(value) for value in self.values):
            raise ValueError("feature values must be finite")


@dataclass(frozen=True, slots=True)
class Candidate3Unit:
    opportunity: TreatmentOpportunity
    outcome: int
    features: tuple[Candidate3FeatureValue, ...]

    def __post_init__(self) -> None:
        if self.outcome not in (0, 1):
            raise ValueError("Candidate 3 outcome must be binary")


@dataclass(frozen=True, slots=True)
class Candidate3Case:
    case_id: str
    units: tuple[Candidate3Unit, ...]

    def __post_init__(self) -> None:
        if not self.case_id.strip():
            raise ValueError("case_id must be non-empty")
        if not self.units:
            raise ValueError("Candidate 3 case requires decision units")


@dataclass(frozen=True, slots=True)
class PreparedCase:
    case_id: str
    subject_ids: tuple[str, ...]
    focal_channel: str
    treatment: np.ndarray
    outcome: np.ndarray
    design_matrix: np.ndarray
    feature_columns: tuple[str, ...]


def prepare_case(
    case: Candidate3Case,
    contract: PretreatmentXContract,
) -> PreparedCase:
    permitted_order = [feature.name for feature in contract.permitted_features]
    expected = set(permitted_order)
    vector_lengths: dict[str, int] = {}
    rows: list[list[float]] = []
    treatment: list[float] = []
    outcome: list[float] = []
    subject_ids: list[str] = []
    focal_channels: set[str] = set()

    for unit in case.units:
        names = [feature.feature_name for feature in unit.features]
        if len(names) != len(set(names)):
            raise ValueError("each pre-treatment feature family must appear at most once")
        if set(names) != expected:
            missing = sorted(expected - set(names))
            extra = sorted(set(names) - expected)
            raise ValueError(
                f"feature families must match frozen X contract; missing={missing}, extra={extra}"
            )

        by_name = {feature.feature_name: feature for feature in unit.features}
        row: list[float] = []
        for name in permitted_order:
            feature = by_name[name]
            validate_feature_observation(
                FeatureObservation(
                    feature_name=feature.feature_name,
                    decision_time=unit.opportunity.decision_time,
                    source_event_times=feature.source_event_times,
                    baseline_available_before_decision=(
                        feature.baseline_available_before_decision
                    ),
                ),
                contract,
            )
            size = len(feature.values)
            previous = vector_lengths.setdefault(name, size)
            if previous != size:
                raise ValueError(
                    f"feature vector length changed for {name}: {previous} -> {size}"
                )
            row.extend(feature.values)

        rows.append(row)
        treatment.append(float(unit.opportunity.treated))
        outcome.append(float(unit.outcome))
        subject_ids.append(unit.opportunity.subject_id)
        focal_channels.add(unit.opportunity.focal_channel)

    if len(focal_channels) != 1:
        raise ValueError("one Candidate 3 case must have exactly one focal channel")

    columns: list[str] = []
    for name in permitted_order:
        for index in range(vector_lengths[name]):
            columns.append(f"{name}[{index}]")

    matrix = np.asarray(rows, dtype=float)
    if matrix.ndim != 2 or matrix.shape[1] != len(columns):
        raise ValueError("invalid prepared Candidate 3 design matrix")

    return PreparedCase(
        case_id=case.case_id,
        subject_ids=tuple(subject_ids),
        focal_channel=next(iter(focal_channels)),
        treatment=np.asarray(treatment, dtype=float),
        outcome=np.asarray(outcome, dtype=float),
        design_matrix=matrix,
        feature_columns=tuple(columns),
    )

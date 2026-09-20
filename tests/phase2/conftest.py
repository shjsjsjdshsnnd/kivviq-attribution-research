from __future__ import annotations

import pytest

from attribution_lab.phase2.holdout_families import HoldoutFamily
from phase2_candidate_sdk import (
    CandidateDeclaration,
    EstimandDefinition,
    EstimandKind,
    FamilyCriterion,
    FalsificationCriteria,
)


@pytest.fixture
def estimand() -> EstimandDefinition:
    return EstimandDefinition(
        kind=EstimandKind.INCREMENTAL_CONVERSION_PROBABILITY,
        population="synthetic subjects with completed observation windows",
        treatment_or_exposure="channel exposure",
        outcome="qualifying conversion",
        horizon_hours=24.0 * 21,
        intervention="force channel exposure",
        comparison="remove channel exposure",
        unit_of_analysis="synthetic subject",
        temporal_ordering="exposure precedes qualifying outcome",
        treatment_regime="single-channel intervention holding declared synthetic world fixed",
        aggregation_target="population-average probability difference by channel",
    )


@pytest.fixture
def criteria() -> FalsificationCriteria:
    families = tuple(family.value for family in HoldoutFamily)
    return FalsificationCriteria(
        primary_success_criteria=("pass every preregistered required holdout family",),
        failure_criteria=("reject on any required-family metric failure",),
        uncertainty_requirements=("finite interval for every channel estimate",),
        robustness_requirements=("repeat deterministic synthetic evaluation",),
        required_holdout_families=families,
        family_rules=tuple(
            FamilyCriterion(
                family=family,
                metric="mean_absolute_error",
                operator="lte",
                threshold=0.25,
            )
            for family in families
        ),
        known_unsupported_cases=("none for infrastructure test double",),
    )


@pytest.fixture
def declaration(
    estimand: EstimandDefinition,
    criteria: FalsificationCriteria,
) -> CandidateDeclaration:
    return CandidateDeclaration(
        candidate_id="mock-candidate",
        version="1.0.0",
        estimand=estimand,
        hypothesis="Infrastructure test double for Phase 2 harness validation.",
        required_observable_inputs=("ordered channel touchpoints", "binary conversion"),
        assumptions=("synthetic-only test data",),
        supported_outcome_type="binary",
        negative_effects_representable=True,
        interactions_representable=True,
        uncertainty_method="fixed synthetic interval for harness testing",
        hyperparameters=(("constant", "0.0"),),
        hyperparameter_selection_procedure="fixed before any holdout evaluation",
        development_world_usage=("development-smoke-v1",),
        randomization_behavior="deterministic",
        expected_failure_conditions=("non-zero effects exceed fixed interval",),
        falsification_criteria=criteria,
    )


@pytest.fixture
def valid_candidate_source() -> str:
    return """
from phase2_candidate_sdk import CandidateResponse

FALLBACK_CHANNELS = tuple(f"channel_{letter}" for letter in "abcdefgh")

def estimate(dataset, context):
    channels = sorted({
        touch.channel
        for journey in dataset.journeys
        for session in journey.sessions
        for touch in session.touchpoints
    })
    if not channels:
        channels = list(FALLBACK_CHANNELS)
    estimates = {channel: 0.0 for channel in channels}
    lower = {channel: -1.0 for channel in channels}
    upper = {channel: 1.0 for channel in channels}
    return CandidateResponse.from_mappings(
        estimates,
        uncertainty_method="fixed-test-interval",
        lower=lower,
        upper=upper,
        replications=1,
    )
"""

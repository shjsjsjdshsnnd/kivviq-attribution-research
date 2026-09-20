from __future__ import annotations

import math

import pytest

from phase2_candidate_sdk import (
    CandidateResponse,
    EstimandDefinition,
    EstimandKind,
    validate_candidate_response,
)


def test_estimand_requires_explicit_horizon() -> None:
    with pytest.raises(ValueError):
        EstimandDefinition(
            kind=EstimandKind.AVERAGE_TREATMENT_EFFECT,
            population="synthetic subjects",
            treatment_or_exposure="channel",
            outcome="conversion",
            horizon_hours=0,
            intervention="force exposure",
            comparison="remove exposure",
            unit_of_analysis="subject",
            temporal_ordering="exposure before outcome",
            treatment_regime="binary intervention",
            aggregation_target="population average",
        )


def test_invalid_nan_candidate_output_is_rejected() -> None:
    response = CandidateResponse.from_mappings({"channel_a": math.nan})
    with pytest.raises(ValueError):
        validate_candidate_response(response)


def test_uncertainty_must_cover_estimate_keys() -> None:
    response = CandidateResponse.from_mappings(
        {"channel_a": 0.1, "channel_b": 0.2},
        uncertainty_method="test",
        lower={"channel_a": 0.0},
        upper={"channel_a": 0.2},
    )
    with pytest.raises(ValueError):
        validate_candidate_response(response)

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from phase2_candidate3_contracts.contracts import Candidate3Decision
from phase2_candidate3_estimator.input import (
    Candidate3Case,
    Candidate3FeatureValue,
    Candidate3Unit,
)
from phase2_candidate3_estimator.model import point_estimate_for_development

from phase2_candidate3_contracts.contracts import TreatmentOpportunity


def _unit(index: int, *, treated: bool, future: bool = False) -> Candidate3Unit:
    decision = datetime(2032, 1, 2, tzinfo=UTC) + timedelta(hours=index)
    before = decision - timedelta(hours=1)
    after = decision + timedelta(minutes=1)
    source = (after,) if future else (before,)
    return Candidate3Unit(
        opportunity=TreatmentOpportunity(
            subject_id=f"u-{index}",
            focal_channel="meta",
            decision_time=decision,
            treated=treated,
            opportunity_source="declared_treatment_decision_opportunity",
        ),
        outcome=index % 2,
        features=(
            Candidate3FeatureValue(
                "prior_non_focal_channel_exposure_indicators",
                (float(index % 2), 0.0),
                source,
            ),
            Candidate3FeatureValue("prior_touch_count", (0.2,), source),
            Candidate3FeatureValue("prior_completed_session_count", (0.1,), source),
            Candidate3FeatureValue(
                "prior_channel_recency_hours",
                (0.1, 0.2),
                source,
            ),
            Candidate3FeatureValue(
                "elapsed_observation_hours",
                (0.05,),
                (),
                True,
            ),
            Candidate3FeatureValue(
                "declared_baseline_covariates",
                (index / 30.0, (index % 3) / 3.0),
                (),
                True,
            ),
        ),
    )


def test_post_treatment_feature_forces_pretreatment_abstention() -> None:
    units = tuple(
        _unit(index, treated=index % 2 == 0, future=index == 0)
        for index in range(50)
    )
    result = point_estimate_for_development(
        Candidate3Case("future-leak", units),
        propensity_l2=1.0,
    )
    assert (
        result.output.decision
        == Candidate3Decision.ABSTAIN_PRETREATMENT_INVALID
    )
    assert result.output.estimate is None


def test_model_never_populates_full_population_ate() -> None:
    units = tuple(
        _unit(index, treated=index % 2 == 0)
        for index in range(120)
    )
    result = point_estimate_for_development(
        Candidate3Case("ato-only", units),
        propensity_l2=1.0,
    )
    assert result.output.full_population_ate is None


def test_full_estimator_rejects_reduced_bootstrap_count() -> None:
    from phase2_candidate3_estimator.model import estimate

    units = tuple(
        _unit(index, treated=index % 2 == 0)
        for index in range(120)
    )
    with pytest.raises(ValueError):
        estimate(
            Candidate3Case("bootstrap-contract", units),
            lineage_fingerprint="test-lineage",
            bootstrap_replicates=50,
            propensity_l2=1.0,
        )


def test_development_worlds_cover_three_success_behaviors() -> None:
    import sys
    from pathlib import Path

    root = Path("phase2/candidates/candidate3")
    sys.path.insert(0, str(root))
    try:
        from development_worlds import development_worlds
    finally:
        sys.path.remove(str(root))

    expected = {world.expected_decision for world in development_worlds()}
    assert "ESTIMATE_ATO" in expected
    assert "ABSTAIN_INADEQUATE_SUPPORT" in expected
    assert "ABSTAIN_INADEQUATE_FINITE_SAMPLE" in expected
    assert "ABSTAIN_PRETREATMENT_INVALID" in expected

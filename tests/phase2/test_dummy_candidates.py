from __future__ import annotations

from dataclasses import replace

import pytest

from attribution_lab.phase2.development import DevelopmentWorldRecord
from attribution_lab.phase2.registration import CandidateRegistry, CandidateVersionConflict
from attribution_lab.phase2_evaluator.evaluator import (
    HoldoutEvaluator,
    evaluate_known_case,
)
from attribution_lab.phase2_evaluator.gates import apply_preregistered_gate
from attribution_lab.phase2_evaluator.isolation import (
    CandidateRunner,
    ForbiddenCandidateImport,
)
from attribution_lab.phase2_evaluator.results import (
    REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    EvaluationStage,
    GateOutcome,
    SeparatedEvaluationReport,
)
from attribution_lab.phase2_evaluator.seals import HoldoutSealStore
from phase2_candidate_sdk import DeclaredContext, ObservableDataset


def test_deliberate_oracle_import_candidate_is_blocked() -> None:
    source = """
from attribution_lab.phase2_evaluator.holdout_dgp import OracleTruth
def estimate(dataset, context):
    return None
"""
    with pytest.raises(ForbiddenCandidateImport):
        CandidateRunner().execute(
            source,
            ObservableDataset(journeys=()),
            DeclaredContext(
                stage="SEALED_HOLDOUT",
                scenario_family="selection_shift",
                estimand_fingerprint="x",
                holdout_version="holdout-v1",
            ),
        )


def test_holdout_config_import_candidate_is_blocked() -> None:
    source = """
from attribution_lab.phase2_evaluator.seals import HoldoutSealStore
def estimate(dataset, context):
    return None
"""
    with pytest.raises(ForbiddenCandidateImport):
        CandidateRunner().execute(
            source,
            ObservableDataset(journeys=()),
            DeclaredContext(
                stage="SEALED_HOLDOUT",
                scenario_family="selection_shift",
                estimand_fingerprint="x",
                holdout_version="holdout-v1",
            ),
        )


def test_hyperparameter_mutation_requires_new_version(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    development = DevelopmentWorldRecord(
        candidate_id=declaration.candidate_id,
        candidate_version=declaration.version,
        world_ids=("dev",),
        parameter_ranges=(("x", "1..2"),),
        architecture_selection_notes="fixed",
        hyperparameter_selection_notes="fixed",
    )
    registry = CandidateRegistry(tmp_path)
    registry.register(declaration, valid_candidate_source, development)

    changed = replace(
        declaration,
        hyperparameters=(("constant", "0.5"),),
    )
    with pytest.raises(CandidateVersionConflict):
        registry.register(changed, valid_candidate_source, development)


def test_development_overfit_test_double_is_rejected_on_holdout(
    tmp_path,
    declaration,
) -> None:
    source = """
from phase2_candidate_sdk import CandidateResponse

FALLBACK = tuple(f"channel_{letter}" for letter in "abcdefgh")

def estimate(dataset, context):
    channels = sorted({
        touch.channel
        for journey in dataset.journeys
        for session in journey.sessions
        for touch in session.touchpoints
    }) or list(FALLBACK)
    value = 0.0 if context.stage == "DEVELOPMENT" else 5.0
    estimates = {channel: value for channel in channels}
    lower = {channel: value - 0.1 for channel in channels}
    upper = {channel: value + 0.1 for channel in channels}
    return CandidateResponse.from_mappings(
        estimates,
        uncertainty_method="mock",
        lower=lower,
        upper=upper,
        replications=1,
    )
"""
    development = DevelopmentWorldRecord(
        candidate_id=declaration.candidate_id,
        candidate_version=declaration.version,
        world_ids=("development-overfit-world",),
        parameter_ranges=(("synthetic", "known"),),
        architecture_selection_notes="deliberately overfit infrastructure test double",
        hyperparameter_selection_notes="fixed before holdout",
    )
    registry = CandidateRegistry(tmp_path / "registrations")
    registry.register(declaration, source, development)

    generic_truth = tuple(
        (f"channel_{letter}", 0.0) for letter in "abcdefgh"
    )
    development_result = evaluate_known_case(
        declaration,
        source,
        dataset=ObservableDataset(journeys=()),
        synthetic_truth=generic_truth,
        stage=EvaluationStage.DEVELOPMENT,
        family="development-overfit-world",
    )
    assert dict(development_result.metrics)["mean_absolute_error"] == 0.0

    seals = HoldoutSealStore(tmp_path / "seals")
    seals.create(
        "holdout-v1",
        seed=808,
        created_at="2030-01-01T00:00:00+00:00",
    )
    holdout_results = HoldoutEvaluator(seals, registry).evaluate(
        declaration,
        source,
        holdout_version="holdout-v1",
    )
    report = SeparatedEvaluationReport(
        development_results=(development_result,),
        frozen_phase1_results=(),
        sealed_holdout_results=holdout_results,
        holdout_limitation_disclosure=REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    )
    assert apply_preregistered_gate(report, declaration).outcome == GateOutcome.REJECT

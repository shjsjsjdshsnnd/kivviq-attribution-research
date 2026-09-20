from __future__ import annotations

from attribution_lab.phase2.development import DevelopmentWorldRecord
from attribution_lab.phase2.phase1_adapter import FrozenPhase1Adapter
from attribution_lab.phase2.registration import CandidateRegistry
from attribution_lab.phase2_evaluator.evaluator import (
    HoldoutEvaluator,
    evaluate_known_case,
)
from attribution_lab.phase2_evaluator.results import EvaluationStage, ScenarioStatus
from attribution_lab.phase2_evaluator.seals import HoldoutSealStore


def test_standardized_holdout_evaluation_runs_without_truth_leakage(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    registry = CandidateRegistry(tmp_path / "registrations")
    development = DevelopmentWorldRecord(
        candidate_id=declaration.candidate_id,
        candidate_version=declaration.version,
        world_ids=("dev-world-1",),
        parameter_ranges=(("latent_intent_weight", "0.2..1.2"),),
        architecture_selection_notes="mock infrastructure test",
        hyperparameter_selection_notes="fixed",
    )
    registry.register(declaration, valid_candidate_source, development)

    seals = HoldoutSealStore(tmp_path / "seals")
    seals.create(
        "holdout-v1",
        seed=2026,
        created_at="2030-01-01T00:00:00+00:00",
    )

    results = HoldoutEvaluator(seals, registry).evaluate(
        declaration,
        valid_candidate_source,
        holdout_version="holdout-v1",
    )
    assert len(results) == 8
    assert all(result.status == ScenarioStatus.EVALUATED for result in results)
    assert all(dict(result.metrics)["coverage_fraction"] == 1.0 for result in results)


def test_missing_uncertainty_is_preserved_as_missing(
    tmp_path,
    declaration,
) -> None:
    source = """
from phase2_candidate_sdk import CandidateResponse

def estimate(dataset, context):
    return CandidateResponse.from_mappings({"channel_a": 0.0})
"""
    registry = CandidateRegistry(tmp_path / "registrations")
    development = DevelopmentWorldRecord(
        candidate_id=declaration.candidate_id,
        candidate_version=declaration.version,
        world_ids=("dev-world-1",),
        parameter_ranges=(("x", "synthetic"),),
        architecture_selection_notes="test",
        hyperparameter_selection_notes="fixed",
    )
    registry.register(declaration, source, development)
    seals = HoldoutSealStore(tmp_path / "seals")
    seals.create(
        "holdout-v1",
        seed=77,
        families=(),
    )
    # Empty tuple means default family set; use a single private family by creating
    # a normal seal and inspect the first result instead.
    results = HoldoutEvaluator(seals, registry).evaluate(
        declaration,
        source,
        holdout_version="holdout-v1",
    )
    assert results
    assert all(not result.uncertainty_present for result in results)


def test_frozen_phase1_uses_same_standardized_candidate_contract(
    declaration,
    valid_candidate_source,
) -> None:
    case = FrozenPhase1Adapter.build_case(
        "balanced_multi_touch",
        seed=7,
        sample_size=40,
        observation_quality="perfect",
    )
    result = evaluate_known_case(
        declaration,
        valid_candidate_source,
        dataset=case.observable_dataset,
        synthetic_truth=case.synthetic_truth,
        stage=EvaluationStage.FROZEN_PHASE1,
        family=case.scenario,
        phase1_reference=case.phase1_reference,
    )
    assert result.stage == EvaluationStage.FROZEN_PHASE1
    assert result.status == ScenarioStatus.EVALUATED

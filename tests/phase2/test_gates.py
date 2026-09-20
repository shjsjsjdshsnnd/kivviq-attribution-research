from __future__ import annotations

from attribution_lab.phase2.holdout_families import HoldoutFamily
from attribution_lab.phase2_evaluator.gates import apply_preregistered_gate
from attribution_lab.phase2_evaluator.results import (
    EvaluationStage,
    GateOutcome,
    ScenarioResult,
    ScenarioStatus,
    SeparatedEvaluationReport,
)


def _result(
    family: str,
    error: float,
    *,
    uncertainty: bool = True,
    status: ScenarioStatus = ScenarioStatus.EVALUATED,
) -> ScenarioResult:
    return ScenarioResult(
        stage=EvaluationStage.SEALED_HOLDOUT,
        family=family,
        status=status,
        metrics=(("mean_absolute_error", error),),
        uncertainty_present=uncertainty,
    )


def test_development_success_cannot_rescue_holdout_failure(declaration) -> None:
    development = ScenarioResult(
        stage=EvaluationStage.DEVELOPMENT,
        family="development-perfect",
        status=ScenarioStatus.EVALUATED,
        metrics=(("mean_absolute_error", 0.0),),
        uncertainty_present=True,
    )
    report = SeparatedEvaluationReport(
        development_results=(development,),
        frozen_phase1_results=(),
        sealed_holdout_results=(
            _result("selection_shift", 0.01),
            _result("unseen_interaction", 0.90),
        ),
    )
    decision = apply_preregistered_gate(report, declaration)
    assert decision.outcome == GateOutcome.REJECT


def test_one_catastrophic_family_cannot_disappear_in_mean(declaration) -> None:
    report = SeparatedEvaluationReport(
        development_results=(),
        frozen_phase1_results=(),
        sealed_holdout_results=(
            _result("selection_shift", 0.0),
            _result("unseen_interaction", 1.0),
        ),
    )
    assert apply_preregistered_gate(report, declaration).outcome == GateOutcome.REJECT


def test_missing_holdout_is_not_passing(declaration) -> None:
    report = SeparatedEvaluationReport(
        development_results=(),
        frozen_phase1_results=(),
        sealed_holdout_results=(_result("selection_shift", 0.0),),
    )
    assert (
        apply_preregistered_gate(report, declaration).outcome
        == GateOutcome.INCONCLUSIVE
    )


def test_unsupported_required_family_is_rejected(declaration) -> None:
    report = SeparatedEvaluationReport(
        development_results=(),
        frozen_phase1_results=(),
        sealed_holdout_results=(
            _result("selection_shift", 0.0),
            _result(
                "unseen_interaction",
                0.0,
                status=ScenarioStatus.UNSUPPORTED,
            ),
        ),
    )
    assert apply_preregistered_gate(report, declaration).outcome == GateOutcome.REJECT


def test_missing_required_uncertainty_rejects(declaration) -> None:
    report = SeparatedEvaluationReport(
        development_results=(),
        frozen_phase1_results=(),
        sealed_holdout_results=(
            _result("selection_shift", 0.0),
            _result("unseen_interaction", 0.0, uncertainty=False),
        ),
    )
    assert apply_preregistered_gate(report, declaration).outcome == GateOutcome.REJECT


def test_frozen_phase1_success_cannot_rescue_holdout_failure(declaration) -> None:
    phase1 = ScenarioResult(
        stage=EvaluationStage.FROZEN_PHASE1,
        family="known-phase1-case",
        status=ScenarioStatus.EVALUATED,
        metrics=(("mean_absolute_error", 0.0),),
        uncertainty_present=True,
    )
    report = SeparatedEvaluationReport(
        development_results=(),
        frozen_phase1_results=(phase1,),
        sealed_holdout_results=(
            _result("unseen_interaction", 1.0),
        ),
    )
    assert apply_preregistered_gate(report, declaration).outcome == GateOutcome.REJECT


def test_changed_holdout_family_set_cannot_silently_pass(declaration) -> None:
    required = tuple(
        _result(family.value, 0.0)
        for family in HoldoutFamily
    )
    unexpected = _result("new_unregistered_holdout_family", 0.0)
    report = SeparatedEvaluationReport(
        development_results=(),
        frozen_phase1_results=(),
        sealed_holdout_results=(*required, unexpected),
    )
    assert (
        apply_preregistered_gate(report, declaration).outcome
        == GateOutcome.INCONCLUSIVE
    )

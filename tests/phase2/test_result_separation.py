import pytest

from attribution_lab.phase2_evaluator.results import (
    EvaluationStage,
    ScenarioResult,
    ScenarioStatus,
    SeparatedEvaluationReport,
)


def test_results_cannot_be_put_in_wrong_section() -> None:
    holdout = ScenarioResult(
        stage=EvaluationStage.SEALED_HOLDOUT,
        family="selection_shift",
        status=ScenarioStatus.EVALUATED,
        metrics=(("mean_absolute_error", 0.1),),
        uncertainty_present=True,
    )
    with pytest.raises(ValueError):
        SeparatedEvaluationReport(
            development_results=(holdout,),
            frozen_phase1_results=(),
            sealed_holdout_results=(),
        )


def test_report_has_no_blended_overall_score() -> None:
    report = SeparatedEvaluationReport((), (), ())
    assert not hasattr(report, "overall_score")
    assert not hasattr(report, "weighted_score")

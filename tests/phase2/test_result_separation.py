import pytest

from attribution_lab.phase2_evaluator.results import (
    REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    EvaluationStage,
    ScenarioResult,
    ScenarioStatus,
    SeparatedEvaluationReport,
)


def _report(
    development_results=(),
    frozen_phase1_results=(),
    sealed_holdout_results=(),
) -> SeparatedEvaluationReport:
    return SeparatedEvaluationReport(
        development_results=development_results,
        frozen_phase1_results=frozen_phase1_results,
        sealed_holdout_results=sealed_holdout_results,
        holdout_limitation_disclosure=REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
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
        _report(development_results=(holdout,))


def test_report_has_no_blended_overall_score() -> None:
    report = _report()
    assert not hasattr(report, "overall_score")
    assert not hasattr(report, "weighted_score")


def test_public_holdout_limitation_disclosure_is_required() -> None:
    with pytest.raises(ValueError):
        SeparatedEvaluationReport(
            development_results=(),
            frozen_phase1_results=(),
            sealed_holdout_results=(),
            holdout_limitation_disclosure="",
        )

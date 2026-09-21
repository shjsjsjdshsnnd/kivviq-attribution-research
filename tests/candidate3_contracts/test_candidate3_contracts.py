from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from phase2_candidate3_contracts.contracts import (
    Candidate3Decision,
    Candidate3OutputContract,
    FeatureObservation,
    FiniteSampleStatus,
    SupportDiagnostics,
    SupportStatus,
    build_ato_estimand_contract,
    build_pretreatment_x_contract,
    build_support_abstention_contract,
    build_uncertainty_contract,
    candidate3_decision,
    contract_bundle,
    finite_sample_status,
    support_status,
    validate_feature_observation,
)


def _adequate() -> SupportDiagnostics:
    return SupportDiagnostics(
        central_overlap_fraction=0.55,
        normalized_overlap_mass=0.60,
        treated_count=120,
        control_count=130,
        total_overlap_ess=180.0,
        treated_overlap_ess=80.0,
        control_overlap_ess=85.0,
        outcome_events=24,
        valid_bootstrap_fraction=0.99,
        interval_width=0.08,
    )


def test_estimand_is_ato_and_never_full_population_ate() -> None:
    contract = build_ato_estimand_contract()
    assert "e(X_t)*(1-e(X_t))" in contract.overlap_weight_definition
    assert contract.full_population_ate_status == "NOT_ESTIMATED"
    assert "does not claim" in contract.latent_confounding_scope


def test_pre_treatment_feature_must_precede_focal_decision() -> None:
    contract = build_pretreatment_x_contract()
    decision_time = datetime(2030, 1, 2, tzinfo=UTC)
    valid = FeatureObservation(
        feature_name="prior_touch_count",
        decision_time=decision_time,
        source_event_times=(decision_time - timedelta(hours=1),),
    )
    validate_feature_observation(valid, contract)

    invalid = FeatureObservation(
        feature_name="prior_touch_count",
        decision_time=decision_time,
        source_event_times=(decision_time + timedelta(seconds=1),),
    )
    with pytest.raises(ValueError):
        validate_feature_observation(invalid, contract)


def test_missing_temporal_provenance_is_not_silently_allowed() -> None:
    contract = build_pretreatment_x_contract()
    observation = FeatureObservation(
        feature_name="prior_touch_count",
        decision_time=datetime(2030, 1, 2, tzinfo=UTC),
        source_event_times=(),
        baseline_available_before_decision=False,
    )
    with pytest.raises(ValueError):
        validate_feature_observation(observation, contract)


def test_forbidden_post_treatment_concepts_are_explicit() -> None:
    contract = build_pretreatment_x_contract()
    text = " ".join(contract.explicitly_forbidden_features).lower()
    for required in (
        "subsequent sessions",
        "later channel",
        "checkout",
        "conversion",
        "identity",
        "future",
    ):
        assert required in text


def test_support_failure_precedes_finite_sample_failure() -> None:
    support = build_support_abstention_contract()
    uncertainty = build_uncertainty_contract()
    diagnostics = SupportDiagnostics(
        central_overlap_fraction=0.05,
        normalized_overlap_mass=0.08,
        treated_count=2,
        control_count=200,
        total_overlap_ess=5.0,
        treated_overlap_ess=1.0,
        control_overlap_ess=4.0,
        outcome_events=2,
    )
    assert support_status(diagnostics, support) == SupportStatus.INADEQUATE
    assert (
        candidate3_decision(
            pretreatment_valid=True,
            diagnostics=diagnostics,
            support_contract=support,
            uncertainty_contract=uncertainty,
        )
        == Candidate3Decision.ABSTAIN_INADEQUATE_SUPPORT
    )


def test_finite_sample_failure_is_distinct_when_overlap_is_adequate() -> None:
    support = build_support_abstention_contract()
    uncertainty = build_uncertainty_contract()
    diagnostics = SupportDiagnostics(
        central_overlap_fraction=0.70,
        normalized_overlap_mass=0.75,
        treated_count=12,
        control_count=15,
        total_overlap_ess=50.0,
        treated_overlap_ess=20.0,
        control_overlap_ess=21.0,
        outcome_events=4,
        valid_bootstrap_fraction=0.90,
        interval_width=0.31,
    )
    assert support_status(diagnostics, support) == SupportStatus.ADEQUATE
    assert (
        finite_sample_status(diagnostics, support, uncertainty)
        == FiniteSampleStatus.INADEQUATE
    )
    assert (
        candidate3_decision(
            pretreatment_valid=True,
            diagnostics=diagnostics,
            support_contract=support,
            uncertainty_contract=uncertainty,
        )
        == Candidate3Decision.ABSTAIN_INADEQUATE_FINITE_SAMPLE
    )


def test_valid_case_estimates_ato() -> None:
    support = build_support_abstention_contract()
    uncertainty = build_uncertainty_contract()
    assert (
        candidate3_decision(
            pretreatment_valid=True,
            diagnostics=_adequate(),
            support_contract=support,
            uncertainty_contract=uncertainty,
        )
        == Candidate3Decision.ESTIMATE_ATO
    )


def test_invalid_pretreatment_contract_has_highest_priority() -> None:
    assert (
        candidate3_decision(
            pretreatment_valid=False,
            diagnostics=_adequate(),
            support_contract=build_support_abstention_contract(),
            uncertainty_contract=build_uncertainty_contract(),
        )
        == Candidate3Decision.ABSTAIN_PRETREATMENT_INVALID
    )


def test_output_contract_forbids_ate_and_forbids_estimate_on_abstention() -> None:
    with pytest.raises(ValueError):
        Candidate3OutputContract(
            decision=Candidate3Decision.ABSTAIN_INADEQUATE_SUPPORT,
            estimand="ATO",
            estimate=0.1,
            interval_lower=0.0,
            interval_upper=0.2,
            target_population="overlap",
            full_population_ate=None,
            support_status=SupportStatus.INADEQUATE,
            finite_sample_status=FiniteSampleStatus.ADEQUATE,
            identification_statement=(
                "conditional on declared pre-treatment observables"
            ),
            latent_confounding_statement="Candidate 3 does not solve latent confounding",
        )


def test_contract_bundle_is_complete_and_fingerprintable() -> None:
    bundle = contract_bundle()
    assert set(bundle["fingerprints"]) == {
        "ato_estimand",
        "pretreatment_x",
        "support_abstention",
        "uncertainty",
    }
    assert all(len(value) == 64 for value in bundle["fingerprints"].values())

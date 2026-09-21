from __future__ import annotations

from candidate3_holdout_evaluator import generate_holdout_case


def _instance(family: str, **overrides):
    base = {
        "family": family,
        "n_units": 700,
        "seed": 123456,
        "treatment_intercept": 0.0,
        "observed_selection_strength": 0.5,
        "latent_selection_strength": 0.0,
        "latent_outcome_strength": 0.0,
        "baseline_outcome_logit": -2.5,
        "treatment_effect_log_odds": 0.45,
        "effect_heterogeneity": 0.0,
        "decision_time_missing_fraction": 0.0,
        "post_treatment_contamination_fraction": 0.0,
        "outcome_rate_shift": 0.0,
    }
    base.update(overrides)
    return base


def main() -> None:
    adequate = generate_holdout_case(
        _instance("adequate_overlap_recovery")
    )
    assert adequate.design_valid
    assert adequate.oracle_expected_decision == "ESTIMATE_ATO"
    assert adequate.ato_truth is not None

    support = generate_holdout_case(
        _instance(
            "inadequate_overlap_abstention",
            treatment_intercept=-6.0,
            observed_selection_strength=0.5,
            n_units=900,
        )
    )
    assert support.design_valid
    assert support.oracle_expected_decision == "ABSTAIN_INADEQUATE_SUPPORT"
    assert support.ato_truth is None

    finite = generate_holdout_case(
        _instance(
            "finite_sample_abstention",
            n_units=65,
            baseline_outcome_logit=-3.8,
        )
    )
    assert finite.design_valid
    assert finite.oracle_expected_decision == "ABSTAIN_INADEQUATE_FINITE_SAMPLE"

    provenance = generate_holdout_case(
        _instance(
            "measurement_provenance_abstention",
            decision_time_missing_fraction=0.2,
            post_treatment_contamination_fraction=0.15,
        )
    )
    assert provenance.design_valid
    assert provenance.provenance_invalid
    assert provenance.oracle_expected_decision == "ABSTAIN_PRETREATMENT_INVALID"

    hetero = generate_holdout_case(
        _instance(
            "heterogeneous_overlap_effect",
            effect_heterogeneity=0.6,
        )
    )
    assert hetero.design_valid
    assert hetero.ato_truth is not None
    assert hetero.ate_truth is not None

    latent = generate_holdout_case(
        _instance(
            "latent_confounding_non_goal",
            latent_selection_strength=1.2,
            latent_outcome_strength=1.2,
        )
    )
    assert latent.design_valid
    assert latent.ato_truth is None

    print("Candidate 3 sealed evaluator self-test passed.")


if __name__ == "__main__":
    main()

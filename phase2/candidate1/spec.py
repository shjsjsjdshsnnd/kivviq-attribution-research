from __future__ import annotations

from attribution_lab.phase2.development import DevelopmentWorldRecord
from attribution_lab.phase2.holdout_families import HoldoutFamily
from phase2_candidate_sdk import (
    CandidateDeclaration,
    EstimandDefinition,
    EstimandKind,
    FalsificationCriteria,
    FamilyCriterion,
)

CANDIDATE_ID = "phase2-candidate1-aipw"
CANDIDATE_VERSION = "1.0.0"

ESTIMAND = EstimandDefinition(
    kind=EstimandKind.INCREMENTAL_CONVERSION_PROBABILITY,
    population=(
        "synthetic subjects with completed 21-day observation windows and observable "
        "pre-outcome channel-exposure histories"
    ),
    treatment_or_exposure=(
        "presence versus absence of one focal channel in the subject's pre-outcome "
        "multi-channel exposure vector"
    ),
    outcome="qualifying conversion within 21 days",
    horizon_hours=504.0,
    intervention=(
        "set the focal channel exposure component to present while holding the other "
        "observed exposure components fixed"
    ),
    comparison=(
        "set the focal channel exposure component to absent while holding the other "
        "observed exposure components fixed"
    ),
    unit_of_analysis="synthetic subject",
    temporal_ordering=(
        "candidate uses only channel touches strictly before the qualifying outcome; "
        "censored subjects are excluded from the target population"
    ),
    treatment_regime="component-wise intervention on a static pre-outcome exposure vector",
    aggregation_target="population-average conversion-probability difference by channel",
)

HOLDOUT_MAE_THRESHOLDS = {
    "selection_shift": 0.08,
    "latent_intent_shift": 0.12,
    "prevalence_ordering_shift": 0.10,
    "time_varying_delayed": 0.15,
    "unseen_interaction": 0.15,
    "negative_heterogeneous": 0.15,
    "sparse_identity_loss": 0.18,
    "compounded_measurement": 0.18,
}

FALSIFICATION = FalsificationCriteria(
    primary_success_criteria=(
        "selection_shift mean_absolute_error <= 0.08 probability points",
        "every required sealed-holdout family satisfies its preregistered MAE ceiling",
        "candidate returns finite signed effects with uncertainty for every observed channel",
    ),
    failure_criteria=(
        "reject on any required-family MAE threshold failure",
        "reject on invalid or unsupported required holdout output",
        "reject if required uncertainty output is missing",
    ),
    uncertainty_requirements=(
        "finite influence-function interval for every returned channel effect",
    ),
    robustness_requirements=(
        "report measurement-loss, sample-size, sparsity, identity-loss, selection-shift, "
        "and temporal-shift behavior without changing methodology after holdout exposure",
    ),
    required_holdout_families=tuple(family.value for family in HoldoutFamily),
    family_rules=tuple(
        FamilyCriterion(
            family=family.value,
            metric="mean_absolute_error",
            operator="lte",
            threshold=HOLDOUT_MAE_THRESHOLDS[family.value],
        )
        for family in HoldoutFamily
    ),
    known_unsupported_cases=(
        "conditional treatment effects are not estimated",
        "explicit treatment-interaction effects are not represented",
        "time-varying treatment effects are not represented by the static exposure vector",
        "conditional exchangeability can fail when latent intent remains hidden",
        "weak overlap can destabilize weighting despite fixed propensity clipping",
    ),
)

DECLARATION = CandidateDeclaration(
    candidate_id=CANDIDATE_ID,
    version=CANDIDATE_VERSION,
    estimand=ESTIMAND,
    hypothesis=(
        "A simple AIPW estimator using only observed co-exposure indicators may reduce "
        "selection-driven synthetic causal-recovery error relative to descriptive attribution, "
        "but should fail when hidden latent intent, poor overlap, interactions, or temporal "
        "structure violate its declared assumptions."
    ),
    required_observable_inputs=(
        "ordered pre-outcome channel touchpoints",
        "channel identity",
        "completed/censored observation status",
        "binary qualifying-conversion outcome",
    ),
    assumptions=(
        "consistency for the declared component-wise intervention",
        "conditional exchangeability given the other observed channel-exposure indicators",
        "sufficient treatment positivity after fixed propensity clipping",
        "no interference between synthetic subjects",
        "static 21-day exposure vector is adequate for the target estimand",
        "other channel indicators are treated as components of the joint exposure regime",
    ),
    supported_outcome_type="binary qualifying conversion within 21 days",
    negative_effects_representable=True,
    interactions_representable=False,
    uncertainty_method="AIPW influence-function normal interval (95%)",
    hyperparameters=(
        ("propensity_clip", "0.05"),
        ("ridge_penalty", "0.02"),
        ("gradient_iterations", "500"),
        ("gradient_learning_rate", "0.15"),
        ("normal_interval_z", "1.96"),
    ),
    hyperparameter_selection_procedure=(
        "fixed before sealed evaluation for numerical stability; no holdout-based selection"
    ),
    development_world_usage=(
        "candidate1-dev-balanced-v1",
        "candidate1-dev-selection-v1",
        "candidate1-dev-negative-v1",
    ),
    randomization_behavior="deterministic estimator; no candidate-side random draws",
    expected_failure_conditions=(
        "hidden latent intent confounds treatment after observable adjustment",
        "explicit interactions materially drive outcomes",
        "effects vary materially over time",
        "overlap is weak or paths are sparse",
        "identity fragmentation or measurement loss corrupts the exposure vector",
    ),
    falsification_criteria=FALSIFICATION,
)

DEVELOPMENT_RECORD = DevelopmentWorldRecord(
    candidate_id=CANDIDATE_ID,
    candidate_version=CANDIDATE_VERSION,
    world_ids=DECLARATION.development_world_usage,
    parameter_ranges=(
        ("n_subjects", "350..700"),
        ("baseline_conversion_probability", "0.04..0.09"),
        ("latent_intent_weight", "0.35..1.35"),
        ("channel_log_odds_effect", "-0.70..0.75"),
        ("selection_strength", "0.0..1.60"),
        ("channel_exposure_probability", "0.15..0.55"),
    ),
    architecture_selection_notes=(
        "single preregistered interpretable AIPW family only; development worlds used for "
        "implementation and numerical-stability checks, not method-family competition"
    ),
    hyperparameter_selection_notes=(
        "ridge, clipping, iteration count, and learning rate fixed on numerical-stability "
        "grounds before frozen Phase 1 or sealed holdout evaluation"
    ),
)

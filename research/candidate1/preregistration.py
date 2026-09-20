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

CANDIDATE_ID = "candidate1-observable-gcomp"
CANDIDATE_VERSION = "1.0.0"

ESTIMAND = EstimandDefinition(
    kind=EstimandKind.INCREMENTAL_CONVERSION_PROBABILITY,
    population=(
        "synthetic subjects observed over the declared 21-day horizon, including "
        "purchasers and completed non-purchasers"
    ),
    treatment_or_exposure=(
        "binary occurrence of at least one observed exposure to each channel during "
        "the subject observation horizon"
    ),
    outcome="qualifying synthetic conversion during the 21-day observation horizon",
    horizon_hours=24.0 * 21,
    intervention=(
        "for each channel separately, set that channel exposure indicator to present "
        "for every subject while leaving observed co-exposures and declared measurement "
        "covariates fixed"
    ),
    comparison=(
        "set the same channel exposure indicator to absent for every subject under the "
        "same fitted outcome model"
    ),
    unit_of_analysis="synthetic subject",
    temporal_ordering=(
        "observed channel exposure precedes the qualifying conversion used as outcome; "
        "post-conversion touches are excluded by the observable journey contract"
    ),
    treatment_regime="single-channel binary intervention evaluated one channel at a time",
    aggregation_target=(
        "population-average difference in predicted conversion probability between "
        "channel-present and channel-absent interventions"
    ),
)

HOLDOUT_FAMILIES = tuple(family.value for family in HoldoutFamily)

FALSIFICATION_CRITERIA = FalsificationCriteria(
    primary_success_criteria=(
        "every required sealed holdout family must satisfy its preregistered rules",
        "selection-bias worlds must not receive special post-holdout tuning",
    ),
    failure_criteria=(
        "reject if any required holdout family exceeds 0.12 mean absolute effect error",
        "reject if any required holdout family omits a channel estimate",
        "reject if uncertainty coverage is below 0.75 in any required holdout family",
    ),
    uncertainty_requirements=(
        "deterministic subject bootstrap percentile interval for every channel estimate",
    ),
    robustness_requirements=(
        "finite estimates under measurement loss, small samples, sparsity, identity loss, "
        "selection shifts, and temporal shifts",
    ),
    required_holdout_families=HOLDOUT_FAMILIES,
    family_rules=tuple(
        rule
        for family in HOLDOUT_FAMILIES
        for rule in (
            FamilyCriterion(
                family=family,
                metric="mean_absolute_error",
                operator="lte",
                threshold=0.12,
            ),
            FamilyCriterion(
                family=family,
                metric="coverage_fraction",
                operator="gte",
                threshold=1.0,
            ),
            FamilyCriterion(
                family=family,
                metric="interval_coverage_fraction",
                operator="gte",
                threshold=0.75,
            ),
        )
    ),
    known_unsupported_cases=(
        "identification under strong unmeasured latent-intent confounding is not guaranteed",
        "the model does not parameterize treatment interactions",
        "the model does not parameterize heterogeneous or time-varying treatment effects",
    ),
)

DECLARATION = CandidateDeclaration(
    candidate_id=CANDIDATE_ID,
    version=CANDIDATE_VERSION,
    estimand=ESTIMAND,
    hypothesis=(
        "An interpretable multivariable logistic outcome-regression estimator with "
        "g-computation over observed channel indicators can reduce synthetic causal "
        "misallocation under selection bias relative to descriptive attribution by "
        "conditioning on observed co-exposures and measurement covariates. The hypothesis "
        "is falsified if preregistered selection/null-effect criteria or any required "
        "sealed-holdout family gate fails. Hidden latent intent remains intentionally "
        "unavailable, so strong residual confounding is an expected failure mode."
    ),
    required_observable_inputs=(
        "subject-level binary channel exposure indicators derived from ordered pre-outcome touches",
        "binary qualifying conversion outcome",
        "observation-window duration",
        "identity-confidence measurement field",
        "censoring indicator",
    ),
    assumptions=(
        "consistency of the declared binary channel intervention",
        "positivity/overlap for channel exposure in the analyzed synthetic population",
        "conditional exchangeability is approximated only with declared observable covariates",
        "true latent purchase intent is intentionally hidden and unavailable",
        "true treatment effects and oracle counterfactual outcomes are unavailable",
        "hidden selection coefficients and hidden interaction effects are unavailable",
        "negative average effects are representable because channel coefficients are signed",
        "heterogeneous effects are not explicitly represented; the target is a marginal average",
        "interactions are not explicitly represented in Candidate 1",
    ),
    supported_outcome_type="binary conversion",
    negative_effects_representable=True,
    interactions_representable=False,
    uncertainty_method=(
        "deterministic nonparametric subject bootstrap with percentile intervals"
    ),
    hyperparameters=(
        ("l2_penalty", "1.0"),
        ("max_newton_iterations", "40"),
        ("coefficient_tolerance", "1e-8"),
        ("probability_clip", "1e-6"),
        ("bootstrap_replications", "32"),
    ),
    hyperparameter_selection_procedure=(
        "fixed before estimator implementation; development worlds may diagnose numerical "
        "stability but do not tune these values against Phase 1 or sealed holdouts"
    ),
    development_world_usage=(
        "candidate1-dev-randomized-v1",
        "candidate1-dev-observed-selection-v1",
        "candidate1-dev-null-effect-v1",
    ),
    randomization_behavior=(
        "deterministic bootstrap seed derived from evaluation stage and scenario-family label"
    ),
    expected_failure_conditions=(
        "strong unmeasured latent-intent confounding",
        "large treatment interactions omitted by the main-effects outcome model",
        "strong heterogeneous treatment effects",
        "time-varying or delayed effects not represented by the binary exposure model",
        "extreme positivity violations or sparse treatment support",
        "severe identity fragmentation or measurement loss",
    ),
    falsification_criteria=FALSIFICATION_CRITERIA,
)

DEVELOPMENT_RECORD = DevelopmentWorldRecord(
    candidate_id=CANDIDATE_ID,
    candidate_version=CANDIDATE_VERSION,
    world_ids=DECLARATION.development_world_usage,
    parameter_ranges=(
        ("baseline_conversion_probability", "0.04..0.12"),
        ("channel_effect_log_odds", "-0.6..0.9"),
        ("observable_selection_strength", "0.0..1.2"),
        ("latent_intent_strength", "0.0..1.0"),
        ("sample_size", "200..800"),
    ),
    architecture_selection_notes=(
        "Candidate 1 is fixed to one interpretable main-effects logistic outcome-regression "
        "architecture with g-computation. Development worlds may reveal implementation "
        "defects but may not trigger a switch to a different estimator family."
    ),
    hyperparameter_selection_notes=(
        "The declared L2 penalty, Newton solver settings, and bootstrap count were fixed "
        "before estimator implementation and before any Phase 1 or holdout evaluation."
    ),
)

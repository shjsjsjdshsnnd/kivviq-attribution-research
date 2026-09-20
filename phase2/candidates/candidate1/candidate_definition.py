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


CANDIDATE_ID = "candidate1-outcome-regression-gcomp"
CANDIDATE_VERSION = "1.0.0"
SELECTED_RIDGE_LAMBDA = 1.0


def build_estimand() -> EstimandDefinition:
    return EstimandDefinition(
        kind=EstimandKind.INCREMENTAL_CONVERSION_PROBABILITY,
        population="synthetic subjects in the declared 21-day observation population",
        treatment_or_exposure=(
            "binary presence versus absence of one focal synthetic channel exposure"
        ),
        outcome="qualifying conversion within the 21-day horizon",
        horizon_hours=504.0,
        intervention=(
            "set focal channel exposure present while holding other observed channel "
            "indicators and measurement covariates fixed"
        ),
        comparison="set the same focal channel exposure absent",
        unit_of_analysis="synthetic subject",
        temporal_ordering=(
            "only exposures observable before the qualifying outcome/horizon enter treatment"
        ),
        treatment_regime="one-channel-at-a-time static binary intervention",
        aggregation_target=(
            "population-average predicted conversion-probability difference by channel"
        ),
    )


def _family_rules() -> tuple[FamilyCriterion, ...]:
    rules: list[FamilyCriterion] = []
    for family in HoldoutFamily:
        if family == HoldoutFamily.SELECTION_SHIFT:
            mae_limit = 0.08
        elif family == HoldoutFamily.NEGATIVE_HETEROGENEOUS:
            mae_limit = 0.12
        else:
            mae_limit = 0.10
        rules.extend(
            [
                FamilyCriterion(
                    family=family.value,
                    metric="mean_absolute_error",
                    operator="lte",
                    threshold=mae_limit,
                ),
                FamilyCriterion(
                    family=family.value,
                    metric="coverage_fraction",
                    operator="gte",
                    threshold=1.0,
                ),
                FamilyCriterion(
                    family=family.value,
                    metric="interval_coverage_fraction",
                    operator="gte",
                    threshold=0.75,
                ),
            ]
        )
    return tuple(rules)


def build_criteria() -> FalsificationCriteria:
    families = tuple(family.value for family in HoldoutFamily)
    return FalsificationCriteria(
        primary_success_criteria=(
            "pass every preregistered required sealed-holdout family",
            "satisfy frozen Phase 1 causal-recovery and robustness criteria",
        ),
        failure_criteria=(
            "reject on any required holdout-family rule failure",
            "reject on any preregistered frozen Phase 1 criterion failure",
            "reject on invalid or non-finite required output",
        ),
        uncertainty_requirements=(
            "approximate 90% model-based interval for every reported channel effect",
            "sealed-family interval coverage fraction at least 0.75",
        ),
        robustness_requirements=(
            "balanced missing-25 L1 effect-vector divergence from perfect <= 0.10",
            "balanced missing-50 L1 effect-vector divergence from perfect <= 0.18",
            "finite outputs in preregistered small-sample checks",
        ),
        required_holdout_families=families,
        family_rules=_family_rules(),
        known_unsupported_cases=(
            "individual heterogeneous effects are not estimated",
            "explicit treatment interactions are not parameterized",
            "time-varying treatment effects are collapsed to ever-exposed indicators",
            "hidden latent intent can violate conditional exchangeability",
        ),
    )


def build_declaration() -> CandidateDeclaration:
    return CandidateDeclaration(
        candidate_id=CANDIDATE_ID,
        version=CANDIDATE_VERSION,
        estimand=build_estimand(),
        hypothesis=(
            "Regularized logistic outcome regression with g-computation may recover "
            "average synthetic channel effects when observed co-exposure structure is "
            "informative, but should fail when hidden-intent selection or unsupported "
            "effect structure violates its assumptions."
        ),
        required_observable_inputs=(
            "ordered observable synthetic channel touchpoints",
            "qualifying conversion indicator",
            "identity confidence",
            "consent observability",
            "observation completeness/censoring",
        ),
        assumptions=(
            "conditional exchangeability given declared observable features",
            "positivity/overlap for focal channel exposure",
            "adequate additive logistic outcome-model approximation",
            "no interference between synthetic subjects",
            "declared observation condition determines available exposure evidence",
        ),
        supported_outcome_type="binary conversion",
        negative_effects_representable=True,
        interactions_representable=False,
        uncertainty_method=(
            "approximate 90% Wald interval from penalized observed information "
            "and delta-method average marginal contrast"
        ),
        hyperparameters=(("ridge_lambda", "1.0"),),
        hyperparameter_selection_procedure=(
            "preregistered grid {0.05,0.2,1.0}; lowest mean DEVELOPMENT "
            "synthetic-effect MAE; ties favor stronger regularization"
        ),
        development_world_usage=(
            "candidate1-dev-balanced-v1",
            "candidate1-dev-null-negative-v1",
            "candidate1-dev-observed-selection-stress-v1",
            "candidate1-dev-sparse-v1",
        ),
        randomization_behavior="deterministic estimator; no candidate-side randomization",
        expected_failure_conditions=(
            "hidden-intent selection not captured by observable covariates",
            "strong unmodelled treatment interactions",
            "strong time-varying or delayed effects",
            "severe measurement loss or identity fragmentation",
            "sparse exposure support or near-separation",
        ),
        falsification_criteria=build_criteria(),
    )


def build_development_record() -> DevelopmentWorldRecord:
    return DevelopmentWorldRecord(
        candidate_id=CANDIDATE_ID,
        candidate_version=CANDIDATE_VERSION,
        world_ids=(
            "candidate1-dev-balanced-v1",
            "candidate1-dev-null-negative-v1",
            "candidate1-dev-observed-selection-stress-v1",
            "candidate1-dev-sparse-v1",
        ),
        parameter_ranges=(
            ("ridge_lambda", "{0.05,0.2,1.0}"),
            ("development_subject_count", "120..500"),
            ("latent_intent_weight", "0.55"),
            ("selection_strength_stress", "0..1.5"),
        ),
        architecture_selection_notes=(
            "single preregistered ridge-logistic outcome-regression/g-computation family; "
            "no alternative estimator family evaluated"
        ),
        hyperparameter_selection_notes=(
            "ridge 1.0 selected by preregistered DEVELOPMENT-only mean-MAE rule"
        ),
    )

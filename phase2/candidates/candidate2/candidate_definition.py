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

CANDIDATE_ID = "candidate2-aipw-dr-observable"
CANDIDATE_VERSION = "1.0.0"
SELECTED_OUTCOME_L2 = 5.0
SELECTED_PROPENSITY_L2 = 5.0
PROPENSITY_CLIP = "0.025:0.975"


def build_estimand() -> EstimandDefinition:
    return EstimandDefinition(
        kind=EstimandKind.INCREMENTAL_CONVERSION_PROBABILITY,
        population=(
            "synthetic subjects in the declared 21-day observation population with "
            "an observable treatment/outcome record under the declared measurement condition"
        ),
        treatment_or_exposure=(
            "binary presence versus absence of one focal synthetic channel exposure"
        ),
        outcome="qualifying conversion within the 21-day observation horizon",
        horizon_hours=504.0,
        intervention=(
            "set focal channel exposure present while retaining the declared observable "
            "non-focal exposure/history covariates as the controlled background regime"
        ),
        comparison="set the same focal channel exposure absent",
        unit_of_analysis="synthetic subject",
        temporal_ordering=(
            "only information observable before the qualifying outcome or end of horizon "
            "may enter treatment, outcome or adjustment features"
        ),
        treatment_regime="one-channel-at-a-time static binary intervention",
        aggregation_target=(
            "population-average signed conversion-probability difference by channel"
        ),
    )


def _family_rules() -> tuple[FamilyCriterion, ...]:
    rules: list[FamilyCriterion] = []
    for family in HoldoutFamily:
        rules.extend(
            [
                FamilyCriterion(
                    family=family.value,
                    metric="mean_absolute_error",
                    operator="lte",
                    threshold=0.09,
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
                    threshold=0.875,
                ),
                FamilyCriterion(
                    family=family.value,
                    metric="mean_interval_width",
                    operator="lte",
                    threshold=0.35,
                ),
            ]
        )
    return tuple(rules)


def build_criteria() -> FalsificationCriteria:
    families = tuple(family.value for family in HoldoutFamily)
    return FalsificationCriteria(
        primary_success_criteria=(
            "pass the preregistered frozen Phase 1 pre-holdout gate",
            "pass every required sealed Candidate 2 holdout family",
            "reduce aggregate frozen Phase 1 selection/null error versus frozen Candidate 1",
        ),
        failure_criteria=(
            "reject on any required pre-holdout criterion failure",
            "reject on any required holdout-family rule failure",
            "reject on preregistered overlap/positivity failure",
            "reject on invalid or non-finite required output",
        ),
        uncertainty_requirements=(
            "nominal 90% influence-function interval for every reported channel effect",
            "sealed-family interval coverage fraction at least 0.875",
        ),
        robustness_requirements=(
            "missing-50 mean absolute effect-vector change <= 0.15",
            "fragmented-identity mean absolute effect-vector change <= 0.15",
            "finite outputs in preregistered small-sample checks",
            "raw propensity and effective-sample-size diagnostics remain available",
        ),
        required_holdout_families=families,
        family_rules=_family_rules(),
        known_unsupported_cases=(
            "unobserved confounding can violate exchangeability",
            "explicit treatment interactions are not nuisance-model features",
            "time-varying treatment effects are collapsed to static exposure indicators",
            "heterogeneous individual treatment effects are not a declared estimand",
        ),
    )


def build_declaration() -> CandidateDeclaration:
    return CandidateDeclaration(
        candidate_id=CANDIDATE_ID,
        version=CANDIDATE_VERSION,
        estimand=build_estimand(),
        hypothesis=(
            "An interpretable AIPW estimator combining logistic outcome and propensity "
            "nuisance models may reduce error from observed treatment-selection mechanisms "
            "when causal identification assumptions hold and at least one nuisance model "
            "is sufficiently specified; it remains vulnerable to genuinely unobserved confounding."
        ),
        required_observable_inputs=(
            "observable synthetic channel touchpoints before outcome/horizon",
            "qualifying conversion indicator",
            "non-focal channel exposure indicators",
            "observable non-focal touch/session/timing summaries",
            "identity confidence",
            "consent observability",
            "censoring/observation completeness",
        ),
        assumptions=(
            "conditional exchangeability given declared observable adjustment variables",
            "positivity/overlap for focal-channel treatment",
            "consistency of the declared binary intervention",
            "no interference between synthetic subjects",
            "at least one nuisance model is sufficiently specified under the identification assumptions",
            "doubly robust does not mean robust to unobserved confounding",
        ),
        supported_outcome_type="binary qualifying conversion",
        negative_effects_representable=True,
        interactions_representable=False,
        uncertainty_method="90% empirical AIPW influence-function normal interval",
        hyperparameters=(
            ("outcome_l2", "5.0"),
            ("propensity_l2", "5.0"),
            ("propensity_clip", PROPENSITY_CLIP),
            ("max_iterations", "60"),
            ("convergence_tolerance", "1e-8"),
        ),
        hyperparameter_selection_procedure=(
            "development-only 3x3 L2 grid; lowest mean synthetic effect MAE across six "
            "preregistered development worlds among numerically valid pairs; no Candidate 1 "
            "holdout, Candidate 2 holdout, or frozen Phase 1 result used"
        ),
        development_world_usage=(
            "c2-dev-balanced-v1",
            "c2-dev-observed-selection-v1",
            "c2-dev-null-selection-v1",
            "c2-dev-negative-v1",
            "c2-dev-positivity-v1",
            "c2-dev-measurement-v1",
        ),
        randomization_behavior="deterministic estimator; synthetic development worlds use fixed declared seeds",
        expected_failure_conditions=(
            "important confounders remain unobserved",
            "positivity or effective overlap fails",
            "both nuisance models are materially misspecified",
            "measurement loss removes necessary confounders/exposure information",
            "support is sparse",
            "interactions or time variation exceed declared model structure",
        ),
        falsification_criteria=build_criteria(),
    )


def build_development_record() -> DevelopmentWorldRecord:
    return DevelopmentWorldRecord(
        candidate_id=CANDIDATE_ID,
        candidate_version=CANDIDATE_VERSION,
        world_ids=build_declaration().development_world_usage,
        parameter_ranges=(
            ("outcome_l2", "0.1|1.0|5.0"),
            ("propensity_l2", "0.1|1.0|5.0"),
            ("propensity_clip", "fixed 0.025..0.975"),
        ),
        architecture_selection_notes=(
            "AIPW family, nuisance architectures, covariates, clipping and uncertainty "
            "were preregistered before implementation. Candidate 1 holdout metrics were "
            "not used to choose architecture or development worlds."
        ),
        hyperparameter_selection_notes=(
            "selected outcome_l2=5.0 and propensity_l2=5.0 from DEVELOPMENT only; "
            "Candidate 1 sealed-holdout metrics, Candidate 2 holdout and frozen Phase 1 "
            "were not used"
        ),
    )

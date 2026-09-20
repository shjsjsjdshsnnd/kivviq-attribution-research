from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from attribution_lab.phase2.development import DevelopmentWorldRecord
from attribution_lab.phase2.holdout_families import HoldoutFamily
from phase2_candidate_sdk import (
    CandidateDeclaration,
    EstimandDefinition,
    EstimandKind,
    FalsificationCriteria,
    FamilyCriterion,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
ROOT = Path(__file__).resolve().parent
PREREGISTRATION_PATH = (
    REPOSITORY_ROOT / "phase2_candidates" / "candidate1" / "preregistration.json"
)


def preregistration_payload() -> dict[str, Any]:
    loaded = json.loads(PREREGISTRATION_PATH.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError("Candidate 1 preregistration must be a JSON object")
    return loaded


def declaration(
    *,
    propensity_l2: float,
    propensity_clip: float,
    bootstrap_reps: int,
) -> CandidateDeclaration:
    payload = preregistration_payload()
    estimand = payload["estimand"]
    if not isinstance(estimand, dict):
        raise ValueError("estimand preregistration is invalid")

    thresholds = payload["falsification_criteria"]
    if not isinstance(thresholds, dict):
        raise ValueError("falsification preregistration is invalid")
    rules_payload = thresholds["primary_holdout_rules"]
    if not isinstance(rules_payload, dict):
        raise ValueError("holdout rules are invalid")

    rules: list[FamilyCriterion] = []
    for family in HoldoutFamily:
        configured = rules_payload[family.value]
        if not isinstance(configured, dict):
            raise ValueError(f"missing rules for {family.value}")
        rules.extend(
            (
                FamilyCriterion(
                    family=family.value,
                    metric="mean_absolute_error",
                    operator="lte",
                    threshold=float(configured["mean_absolute_error_lte"]),
                ),
                FamilyCriterion(
                    family=family.value,
                    metric="coverage_fraction",
                    operator="gte",
                    threshold=float(configured["coverage_fraction_gte"]),
                ),
                FamilyCriterion(
                    family=family.value,
                    metric="interval_coverage_fraction",
                    operator="gte",
                    threshold=float(configured["interval_coverage_fraction_gte"]),
                ),
                FamilyCriterion(
                    family=family.value,
                    metric="mean_interval_width",
                    operator="lte",
                    threshold=float(configured["mean_interval_width_lte"]),
                ),
            )
        )

    return CandidateDeclaration(
        candidate_id=str(payload["candidate_id"]),
        version=str(payload["version"]),
        estimand=EstimandDefinition(
            kind=EstimandKind.INCREMENTAL_CONVERSION_PROBABILITY,
            population=str(estimand["population"]),
            treatment_or_exposure=str(estimand["treatment_or_exposure"]),
            outcome=str(estimand["outcome"]),
            horizon_hours=float(estimand["horizon_hours"]),
            intervention=str(estimand["intervention"]),
            comparison=str(estimand["comparison"]),
            unit_of_analysis=str(estimand["unit_of_analysis"]),
            temporal_ordering=str(estimand["temporal_ordering"]),
            treatment_regime=str(estimand["treatment_regime"]),
            aggregation_target=str(estimand["aggregation_target"]),
        ),
        hypothesis=str(payload["hypothesis"]["statement"]),
        required_observable_inputs=tuple(
            str(value) for value in payload["required_observable_inputs"]
        ),
        assumptions=tuple(str(value) for value in payload["assumptions"]),
        supported_outcome_type="binary conversion within fixed horizon",
        negative_effects_representable=True,
        interactions_representable=False,
        uncertainty_method=(
            "deterministic fixed-propensity subject bootstrap, 90% percentile interval"
        ),
        hyperparameters=(
            ("propensity_l2", str(propensity_l2)),
            ("propensity_clip", str(propensity_clip)),
            ("gradient_steps", "300"),
            ("learning_rate", "0.05"),
            ("bootstrap_reps", str(bootstrap_reps)),
        ),
        hyperparameter_selection_procedure=(
            "DEVELOPMENT-only grid over preregistered L2/clip values; select lowest "
            "mean development synthetic-effect MAE; tie -> stronger L2 then wider clip"
        ),
        development_world_usage=tuple(
            str(value) for value in payload["development_worlds_planned"]
        ),
        randomization_behavior=(
            "deterministic bootstrap seed from candidate ID/version/channel"
        ),
        expected_failure_conditions=tuple(
            str(value) for value in payload["expected_failure_conditions"]
        ),
        falsification_criteria=FalsificationCriteria(
            primary_success_criteria=(
                "all required sealed-holdout family rules pass independently",
                "selection/null frozen Phase 1 checks pass",
                "required numerical and uncertainty checks pass",
            ),
            failure_criteria=(
                "any required holdout family rule fails",
                "any preregistered selection/null Phase 1 check fails",
                "numerical invalidity or missing required channel output",
            ),
            uncertainty_requirements=(
                "90% interval for every reported channel",
                "family-specific minimum interval coverage",
                "family-specific maximum mean interval width",
            ),
            robustness_requirements=(
                "50% missing-touch effect-vector L1 divergence <= 0.20",
                "identity-fragmentation effect-vector L1 divergence <= 0.20",
                "finite outputs at sample size 80",
            ),
            required_holdout_families=tuple(
                family.value for family in HoldoutFamily
            ),
            family_rules=tuple(rules),
            known_unsupported_cases=(
                "severe positivity failure",
                "unobserved confounding not proxied by declared observables",
                "separate heterogeneous/interaction estimands",
            ),
        ),
    )


def development_record(
    *,
    propensity_l2: float,
    propensity_clip: float,
) -> DevelopmentWorldRecord:
    payload = preregistration_payload()
    worlds = tuple(str(value) for value in payload["development_worlds_planned"])
    return DevelopmentWorldRecord(
        candidate_id=str(payload["candidate_id"]),
        candidate_version=str(payload["version"]),
        world_ids=worlds,
        parameter_ranges=(
            ("propensity_l2", "0.01|0.1|0.5"),
            ("propensity_clip", "0.03|0.05|0.10"),
            ("latent_intent_selection_strength", "0.8..2.4 DEVELOPMENT only"),
            ("target_structural_effect", "0.0..0.6 DEVELOPMENT only"),
        ),
        architecture_selection_notes=(
            "Estimator family fixed by preregistration before implementation: "
            "logistic propensity + stabilized IPW."
        ),
        hyperparameter_selection_notes=(
            f"Selected DEVELOPMENT-only l2={propensity_l2}, clip={propensity_clip}; "
            "no frozen Phase 1 or holdout feedback used."
        ),
    )

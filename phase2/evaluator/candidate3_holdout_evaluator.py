from __future__ import annotations

import json
import math
import random
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from phase2_candidate3_contracts.contracts import (
    Candidate3Decision,
    SupportDiagnostics,
    TreatmentOpportunity,
    build_support_abstention_contract,
    build_uncertainty_contract,
    candidate3_decision,
)
from phase2_candidate3_estimator.input import (
    Candidate3Case,
    Candidate3FeatureValue,
    Candidate3Unit,
)
from phase2_candidate3_estimator.model import estimate


@dataclass(frozen=True, slots=True)
class GeneratedHoldoutCase:
    family: str
    case: Candidate3Case
    ato_truth: float | None
    ate_truth: float | None
    oracle_expected_decision: str | None
    provenance_invalid: bool
    design_valid: bool
    design_reason: str


def _sigmoid(value: float) -> float:
    if value >= 0:
        exp_value = math.exp(-value)
        return 1.0 / (1.0 + exp_value)
    exp_value = math.exp(value)
    return exp_value / (1.0 + exp_value)


def _ess(weights: list[float]) -> float:
    if not weights:
        return 0.0
    total = sum(weights)
    denominator = sum(weight * weight for weight in weights)
    return 0.0 if denominator <= 0.0 else total * total / denominator


def _oracle_diagnostics(
    propensities: list[float],
    treatment: list[bool],
    outcomes: list[int],
) -> SupportDiagnostics:
    treated_weights = [
        1.0 - propensity
        for propensity, treated in zip(propensities, treatment, strict=True)
        if treated
    ]
    control_weights = [
        propensity
        for propensity, treated in zip(propensities, treatment, strict=True)
        if not treated
    ]
    combined = [
        1.0 - propensity if treated else propensity
        for propensity, treated in zip(propensities, treatment, strict=True)
    ]
    return SupportDiagnostics(
        central_overlap_fraction=(
            sum(0.10 <= propensity <= 0.90 for propensity in propensities)
            / len(propensities)
        ),
        normalized_overlap_mass=(
            4.0
            * sum(propensity * (1.0 - propensity) for propensity in propensities)
            / len(propensities)
        ),
        treated_count=sum(treatment),
        control_count=len(treatment) - sum(treatment),
        total_overlap_ess=_ess(combined),
        treated_overlap_ess=_ess(treated_weights),
        control_overlap_ess=_ess(control_weights),
        outcome_events=sum(outcomes),
    )


def _expected_design_decision(diagnostics: SupportDiagnostics) -> str:
    return candidate3_decision(
        pretreatment_valid=True,
        diagnostics=diagnostics,
        support_contract=build_support_abstention_contract(),
        uncertainty_contract=build_uncertainty_contract(),
    ).value


def generate_holdout_case(instance: dict[str, Any]) -> GeneratedHoldoutCase:
    family = str(instance["family"])
    rng = random.Random(int(instance["seed"]))
    n = int(instance["n_units"])
    origin = datetime(2034, 1, 1, tzinfo=UTC)

    units: list[Candidate3Unit] = []
    effects: list[float] = []
    observed_propensities: list[float] = []
    treatments: list[bool] = []
    outcomes: list[int] = []
    provenance_invalid = False

    for index in range(n):
        decision_time = origin + timedelta(hours=index * 2 + 20)
        x1 = rng.gauss(0.0, 1.0)
        x2 = rng.gauss(0.0, 1.0)
        prior_search = float(rng.random() < _sigmoid(-0.20 + 0.45 * x1))
        prior_email = float(rng.random() < _sigmoid(-0.35 + 0.35 * x2))
        prior_touch_count = max(
            0,
            int(round(1.5 + 0.9 * abs(x1) + 0.6 * abs(x2) + rng.random() * 2)),
        )
        prior_sessions = max(0, min(prior_touch_count, 1 + int(rng.random() * 3)))
        recency_a = 1.0 + 30.0 * rng.random()
        recency_b = 3.0 + 42.0 * rng.random()
        latent = rng.gauss(0.0, 1.0)

        observed_score = 0.70 * x1 - 0.50 * x2 + 0.40 * prior_search
        e_observed = _sigmoid(
            float(instance["treatment_intercept"])
            + float(instance["observed_selection_strength"]) * observed_score
        )
        e_actual = _sigmoid(
            float(instance["treatment_intercept"])
            + float(instance["observed_selection_strength"]) * observed_score
            + float(instance["latent_selection_strength"]) * latent
        )
        treated = rng.random() < e_actual

        tau = (
            float(instance["treatment_effect_log_odds"])
            + float(instance["effect_heterogeneity"]) * x1
        )
        baseline = (
            float(instance["baseline_outcome_logit"])
            + float(instance["outcome_rate_shift"])
            + 0.42 * x1
            - 0.28 * x2
            + 0.18 * prior_email
            + float(instance["latent_outcome_strength"]) * latent
        )
        p0 = _sigmoid(baseline)
        p1 = _sigmoid(baseline + tau)
        outcome = int(rng.random() < (p1 if treated else p0))

        effects.append(p1 - p0)
        observed_propensities.append(e_observed)
        treatments.append(treated)
        outcomes.append(outcome)

        pre_times = tuple(
            decision_time - timedelta(hours=4 + j)
            for j in range(max(prior_touch_count, 1))
        )
        missing_provenance = (
            rng.random() < float(instance["decision_time_missing_fraction"])
        )
        contaminated = (
            rng.random()
            < float(instance["post_treatment_contamination_fraction"])
        )
        if contaminated:
            source_times = (decision_time + timedelta(minutes=3),)
            provenance_invalid = True
        elif missing_provenance:
            source_times = ()
            provenance_invalid = True
        else:
            source_times = pre_times[:prior_touch_count]

        features = (
            Candidate3FeatureValue(
                "prior_non_focal_channel_exposure_indicators",
                (prior_search, prior_email),
                source_times[: max(1, min(len(source_times), 2))],
            ),
            Candidate3FeatureValue(
                "prior_touch_count",
                (prior_touch_count / 8.0,),
                source_times,
            ),
            Candidate3FeatureValue(
                "prior_completed_session_count",
                (prior_sessions / 4.0,),
                pre_times[:prior_sessions],
            ),
            Candidate3FeatureValue(
                "prior_channel_recency_hours",
                (recency_a / 48.0, recency_b / 48.0),
                (
                    decision_time - timedelta(hours=recency_a),
                    decision_time - timedelta(hours=recency_b),
                ),
            ),
            Candidate3FeatureValue(
                "elapsed_observation_hours",
                (20.0 / 504.0,),
                (),
                True,
            ),
            Candidate3FeatureValue(
                "declared_baseline_covariates",
                (x1, x2),
                (),
                True,
            ),
        )
        units.append(
            Candidate3Unit(
                opportunity=TreatmentOpportunity(
                    subject_id=f"{family}-u-{index:04d}",
                    focal_channel="meta",
                    decision_time=decision_time,
                    treated=treated,
                    opportunity_source="declared_treatment_decision_opportunity",
                ),
                outcome=outcome,
                features=features,
            )
        )

    oracle_diagnostics = _oracle_diagnostics(
        observed_propensities,
        treatments,
        outcomes,
    )
    oracle_decision = _expected_design_decision(oracle_diagnostics)

    overlap_weights = [
        propensity * (1.0 - propensity)
        for propensity in observed_propensities
    ]
    denominator = sum(overlap_weights)
    ato = (
        sum(
            weight * effect
            for weight, effect in zip(overlap_weights, effects, strict=True)
        )
        / denominator
        if denominator > 0.0
        else None
    )
    ate = sum(effects) / len(effects)

    expected_by_family = {
        "adequate_overlap_recovery": Candidate3Decision.ESTIMATE_ATO.value,
        "weak_full_support_overlap_recovery": Candidate3Decision.ESTIMATE_ATO.value,
        "inadequate_overlap_abstention": (
            Candidate3Decision.ABSTAIN_INADEQUATE_SUPPORT.value
        ),
        "finite_sample_abstention": (
            Candidate3Decision.ABSTAIN_INADEQUATE_FINITE_SAMPLE.value
        ),
        "measurement_provenance_abstention": (
            Candidate3Decision.ABSTAIN_PRETREATMENT_INVALID.value
        ),
        "heterogeneous_overlap_effect": Candidate3Decision.ESTIMATE_ATO.value,
    }

    design_valid = True
    design_reason = "OK"
    if family == "measurement_provenance_abstention":
        design_valid = provenance_invalid
        if not design_valid:
            design_reason = "measurement family did not instantiate invalid provenance"
    elif family in expected_by_family:
        design_valid = oracle_decision == expected_by_family[family]
        if not design_valid:
            design_reason = (
                f"oracle decision {oracle_decision} did not match family intent "
                f"{expected_by_family[family]}"
            )
    elif family == "latent_confounding_non_goal":
        design_valid = oracle_decision == Candidate3Decision.ESTIMATE_ATO.value
        if not design_valid:
            design_reason = "latent-confounding family lacked adequate observable support"
    elif family == "overlap_boundary":
        design_valid = True
    else:
        design_valid = False
        design_reason = "unknown holdout family"

    effect_scored = family in {
        "adequate_overlap_recovery",
        "weak_full_support_overlap_recovery",
        "heterogeneous_overlap_effect",
    }
    if not effect_scored:
        ato = None
        ate = None

    return GeneratedHoldoutCase(
        family=family,
        case=Candidate3Case(case_id=f"candidate3-holdout-v1:{family}", units=tuple(units)),
        ato_truth=ato,
        ate_truth=ate,
        oracle_expected_decision=(
            Candidate3Decision.ABSTAIN_PRETREATMENT_INVALID.value
            if family == "measurement_provenance_abstention"
            else oracle_decision
        ),
        provenance_invalid=provenance_invalid,
        design_valid=design_valid,
        design_reason=design_reason,
    )


def evaluate_holdout(
    instances: list[dict[str, Any]],
    *,
    lineage_fingerprint: str,
    scoring: dict[str, Any],
) -> dict[str, Any]:
    generated = [generate_holdout_case(instance) for instance in instances]
    design_failures = [
        {"family": case.family, "reason": case.design_reason}
        for case in generated
        if not case.design_valid
    ]

    exact_abstention = dict(scoring["exact_abstention_families"])
    effect_families = set(scoring["effect_scored_families"])
    targeting_families = set(scoring["ato_targeting_families"])
    latent_family = str(scoring["latent_confounding_family"])

    records: list[dict[str, Any]] = []
    effect_errors: list[float] = []
    coverage_hits = 0
    estimate_expected = 0
    estimate_correct = 0
    abstain_expected = 0
    abstain_correct = 0
    targeting_expected = 0
    targeting_correct = 0
    boundary_ok = True
    bootstrap_ok = True
    ate_null_ok = True
    latent_disclaimer_ok = True

    for case in generated:
        result = estimate(
            case.case,
            lineage_fingerprint=lineage_fingerprint,
            propensity_l2=0.1,
        )
        output = result.output
        decision = output.decision.value

        if case.family in effect_families:
            estimate_expected += 1
            estimate_correct += int(decision == Candidate3Decision.ESTIMATE_ATO.value)
        if case.family in exact_abstention:
            abstain_expected += 1
            abstain_correct += int(decision == exact_abstention[case.family])
        if case.family == "overlap_boundary":
            boundary_ok = boundary_ok and decision == case.oracle_expected_decision

        error = None
        covered = None
        closer = None
        if (
            case.family in effect_families
            and decision == Candidate3Decision.ESTIMATE_ATO.value
            and output.estimate is not None
            and case.ato_truth is not None
        ):
            error = abs(output.estimate - case.ato_truth)
            effect_errors.append(error)
            covered = bool(
                output.interval_lower is not None
                and output.interval_upper is not None
                and output.interval_lower <= case.ato_truth <= output.interval_upper
            )
            coverage_hits += int(covered)
            if case.family in targeting_families:
                targeting_expected += 1
                closer = bool(
                    case.ate_truth is not None
                    and abs(output.estimate - case.ato_truth)
                    < abs(output.estimate - case.ate_truth)
                )
                targeting_correct += int(closer)

        if decision == Candidate3Decision.ESTIMATE_ATO.value:
            bootstrap_ok = bootstrap_ok and (
                result.bootstrap_requested == 400
                and result.bootstrap_valid / result.bootstrap_requested >= 0.95
            )
        ate_null_ok = ate_null_ok and output.full_population_ate is None
        if case.family == latent_family:
            latent_disclaimer_ok = latent_disclaimer_ok and (
                "does not solve latent confounding"
                in output.latent_confounding_statement
            )

        records.append(
            {
                "family": case.family,
                "candidate_decision": decision,
                "oracle_expected_decision": case.oracle_expected_decision,
                "design_valid": case.design_valid,
                "effect_scored": case.family in effect_families,
                "ato_truth": case.ato_truth,
                "ate_truth": case.ate_truth,
                "estimate": output.estimate,
                "interval_lower": output.interval_lower,
                "interval_upper": output.interval_upper,
                "absolute_ato_error": error,
                "interval_covers_ato": covered,
                "closer_to_ato_than_ate": closer,
                "bootstrap_requested": result.bootstrap_requested,
                "bootstrap_valid": result.bootstrap_valid,
                "full_population_ate": output.full_population_ate,
                "latent_confounding_statement": output.latent_confounding_statement,
            }
        )

    gates = scoring["gates"]
    mean_error = (
        sum(effect_errors) / len(effect_errors)
        if effect_errors
        else float("inf")
    )
    max_error = max(effect_errors) if effect_errors else float("inf")
    estimate_accuracy = (
        estimate_correct / estimate_expected if estimate_expected else 0.0
    )
    abstention_accuracy = (
        abstain_correct / abstain_expected if abstain_expected else 0.0
    )
    targeting_accuracy = (
        targeting_correct / targeting_expected if targeting_expected else 1.0
    )
    criteria = {
        "effect_estimation_decision_accuracy": {
            "value": estimate_accuracy,
            "threshold": gates["effect_estimation_decision_accuracy"],
            "pass": estimate_accuracy >= gates["effect_estimation_decision_accuracy"],
        },
        "abstention_reason_accuracy": {
            "value": abstention_accuracy,
            "threshold": gates["abstention_reason_accuracy"],
            "pass": abstention_accuracy >= gates["abstention_reason_accuracy"],
        },
        "ato_targeting_accuracy": {
            "value": targeting_accuracy,
            "threshold": gates["ato_targeting_accuracy"],
            "pass": targeting_accuracy >= gates["ato_targeting_accuracy"],
        },
        "mean_absolute_ato_error": {
            "value": mean_error,
            "threshold": gates["mean_absolute_ato_error_lte"],
            "pass": mean_error <= gates["mean_absolute_ato_error_lte"],
        },
        "max_absolute_ato_error": {
            "value": max_error,
            "threshold": gates["max_absolute_ato_error_lte"],
            "pass": max_error <= gates["max_absolute_ato_error_lte"],
        },
        "interval_coverage": {
            "hits": coverage_hits,
            "required": gates["interval_coverage_minimum"],
            "denominator": gates["interval_coverage_denominator"],
            "pass": coverage_hits >= gates["interval_coverage_minimum"],
        },
        "overlap_boundary_behavior": {"pass": boundary_ok},
        "bootstrap_contract": {"pass": bootstrap_ok},
        "full_population_ate_null": {"pass": ate_null_ok},
        "latent_confounding_disclaimer": {"pass": latent_disclaimer_ok},
    }

    if design_failures:
        outcome = str(scoring["design_failure_outcome"])
        reasons = tuple(
            f"{item['family']}: {item['reason']}" for item in design_failures
        )
    else:
        failed = [name for name, value in criteria.items() if not bool(value["pass"])]
        if failed:
            outcome = str(scoring["candidate_gate_failure_outcome"])
            reasons = tuple(f"sealed holdout gate failed: {name}" for name in failed)
        else:
            outcome = str(scoring["all_gates_pass_outcome"])
            reasons = ()

    return {
        "stage": "SEALED_HOLDOUT",
        "holdout_version": "candidate3-holdout-v1",
        "evaluation_protocol_version": scoring["protocol_version"],
        "outcome": outcome,
        "reasons": list(reasons),
        "design_failures": design_failures,
        "criteria": criteria,
        "records": records,
    }


def load_private_instances(path: str | Path) -> list[dict[str, Any]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload["version"] != "candidate3-holdout-v1":
        raise RuntimeError("unexpected Candidate 3 holdout version")
    instances = payload.get("instances")
    if not isinstance(instances, list):
        raise RuntimeError("Candidate 3 private seal is invalid")
    return [dict(item) for item in instances]

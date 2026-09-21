from __future__ import annotations

import json
from pathlib import Path

from phase2_candidate3_contracts.contracts import Candidate3Decision
from phase2_candidate3_estimator.model import (
    estimate,
    point_estimate_for_development,
)

from development_worlds import development_worlds

ROOT = Path(__file__).resolve().parent
L2_GRID = (0.1, 1.0, 5.0)
DEVELOPMENT_LINEAGE = "candidate3-development-only-lineage"


def _evaluate_l2(l2: float) -> dict[str, object]:
    records: list[dict[str, object]] = []
    estimate_errors: list[float] = []
    behavior_failures = 0
    for world in development_worlds():
        result = point_estimate_for_development(
            world.case,
            propensity_l2=l2,
        )
        decision = result.output.decision.value
        behavior_ok = decision == world.expected_decision
        if world.scored_for_hyperparameter_selection and not behavior_ok:
            behavior_failures += 1
        error = None
        if (
            world.scored_for_hyperparameter_selection
            and decision == Candidate3Decision.ESTIMATE_ATO.value
            and world.ato_truth is not None
            and result.output.estimate is not None
        ):
            error = abs(result.output.estimate - world.ato_truth)
            estimate_errors.append(error)

        records.append(
            {
                "world_id": world.world_id,
                "expected_decision": world.expected_decision,
                "actual_decision": decision,
                "behavior_ok": behavior_ok,
                "scored_for_hyperparameter_selection": (
                    world.scored_for_hyperparameter_selection
                ),
                "ato_truth": world.ato_truth,
                "ate_truth": world.ate_truth,
                "estimate": result.output.estimate,
                "absolute_ato_error": error,
                "support_diagnostics": (
                    None
                    if result.diagnostics is None
                    else {
                        "central_overlap_fraction": result.diagnostics.central_overlap_fraction,
                        "normalized_overlap_mass": result.diagnostics.normalized_overlap_mass,
                        "treated_count": result.diagnostics.treated_count,
                        "control_count": result.diagnostics.control_count,
                        "total_overlap_ess": result.diagnostics.total_overlap_ess,
                        "treated_overlap_ess": result.diagnostics.treated_overlap_ess,
                        "control_overlap_ess": result.diagnostics.control_overlap_ess,
                        "outcome_events": result.diagnostics.outcome_events,
                    }
                ),
            }
        )
    mean_error = (
        sum(estimate_errors) / len(estimate_errors)
        if estimate_errors
        else float("inf")
    )
    return {
        "propensity_l2": l2,
        "behavior_failures": behavior_failures,
        "mean_ato_error_on_estimated_scored_worlds": mean_error,
        "records": records,
    }


def main() -> None:
    grid = [_evaluate_l2(l2) for l2 in L2_GRID]
    selected = min(
        grid,
        key=lambda item: (
            int(item["behavior_failures"]),
            float(item["mean_ato_error_on_estimated_scored_worlds"]),
            -float(item["propensity_l2"]),
        ),
    )
    selected_l2 = float(selected["propensity_l2"])

    full_uncertainty: list[dict[str, object]] = []
    for world in development_worlds():
        result = estimate(
            world.case,
            lineage_fingerprint=DEVELOPMENT_LINEAGE,
            propensity_l2=selected_l2,
        )
        full_uncertainty.append(
            {
                "world_id": world.world_id,
                "expected_decision": world.expected_decision,
                "actual_decision": result.output.decision.value,
                "ato_truth": world.ato_truth,
                "ate_truth": world.ate_truth,
                "estimate": result.output.estimate,
                "interval_lower": result.output.interval_lower,
                "interval_upper": result.output.interval_upper,
                "bootstrap_requested": result.bootstrap_requested,
                "bootstrap_valid": result.bootstrap_valid,
                "provenance_valid": result.provenance_valid,
                "support_diagnostics": (
                    None
                    if result.diagnostics is None
                    else {
                        "central_overlap_fraction": result.diagnostics.central_overlap_fraction,
                        "normalized_overlap_mass": result.diagnostics.normalized_overlap_mass,
                        "treated_count": result.diagnostics.treated_count,
                        "control_count": result.diagnostics.control_count,
                        "total_overlap_ess": result.diagnostics.total_overlap_ess,
                        "treated_overlap_ess": result.diagnostics.treated_overlap_ess,
                        "control_overlap_ess": result.diagnostics.control_overlap_ess,
                        "outcome_events": result.diagnostics.outcome_events,
                        "valid_bootstrap_fraction": result.diagnostics.valid_bootstrap_fraction,
                        "interval_width": result.diagnostics.interval_width,
                    }
                ),
            }
        )

    payload = {
        "stage": "DEVELOPMENT",
        "candidate_id": "candidate3-overlap-ato",
        "candidate_version": "1.0.0",
        "estimator_family": "logistic propensity + overlap weighting",
        "full_population_ate_estimated": False,
        "contract_reference": "60173ae35c29983a238eb3c5a98f3c0e94f2d234",
        "holdout_version": "candidate3-holdout-v1",
        "holdout_used_for_tuning": False,
        "candidate1_holdout_used": False,
        "candidate2_holdout_used": False,
        "frozen_phase1_used_for_tuning": False,
        "grid": grid,
        "selection_rule": (
            "minimize preregistered behavior failures first, then mean ATO error "
            "on scored estimate worlds; exact ties choose stronger L2"
        ),
        "selected_propensity_l2": selected_l2,
        "full_uncertainty_validation": full_uncertainty,
        "bootstrap_replicates_per_full_estimate": 400,
    }
    (ROOT / "development_results.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        "CANDIDATE3_DEVELOPMENT="
        + json.dumps(
            {
                "selected_propensity_l2": selected_l2,
                "grid": [
                    {
                        "l2": item["propensity_l2"],
                        "behavior_failures": item["behavior_failures"],
                        "mean_ato_error": item[
                            "mean_ato_error_on_estimated_scored_worlds"
                        ],
                    }
                    for item in grid
                ],
                "full_uncertainty_decisions": {
                    item["world_id"]: item["actual_decision"]
                    for item in full_uncertainty
                },
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

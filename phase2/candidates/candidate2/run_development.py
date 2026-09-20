from __future__ import annotations

# ruff: noqa: I001

import json
import math
from dataclasses import asdict
from pathlib import Path

from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2_evaluator.isolation import CandidateRunner
from attribution_lab.simulation.generator import generate_world
from attribution_lab.stress.corruption import corrupt_world
from phase2_candidate_sdk import DeclaredContext

from development_worlds import development_worlds

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "model.py"
OUTCOME_GRID = (0.1, 1.0, 5.0)
PROPENSITY_GRID = (0.1, 1.0, 5.0)


def _source_for(outcome_l2: float, propensity_l2: float) -> str:
    source = MODEL_PATH.read_text(encoding="utf-8")
    source = source.replace("OUTCOME_L2 = 1.0", f"OUTCOME_L2 = {outcome_l2}")
    source = source.replace(
        "PROPENSITY_L2 = 1.0",
        f"PROPENSITY_L2 = {propensity_l2}",
    )
    return source


def _evaluate_pair(outcome_l2: float, propensity_l2: float) -> dict[str, object]:
    source = _source_for(outcome_l2, propensity_l2)
    runner = CandidateRunner()
    world_results: list[dict[str, object]] = []

    for config, corruption in development_worlds():
        pristine = generate_world(config)
        observed = corrupt_world(pristine, corruption, seed=config.seed + 50_000)
        response = runner.execute(
            source,
            to_observable_dataset(observed.dataset),
            DeclaredContext(
                stage="DEVELOPMENT",
                scenario_family=config.scenario_name,
                estimand_fingerprint="candidate2-preregistered-estimand",
            ),
        )
        estimates = dict(response.estimates)
        truth = {
            channel.value: value
            for channel, value in pristine.manifest.incremental_effect_map().items()
        }
        common = sorted(set(estimates) & set(truth))
        if not common:
            mean_error = float("inf")
            max_error = float("inf")
        else:
            errors = [abs(estimates[key] - truth[key]) for key in common]
            mean_error = sum(errors) / len(errors)
            max_error = max(errors)

        overlap = json.loads(dict(response.diagnostics).get("overlap_json", "{}"))
        converged = all(
            float(values.get("outcome_converged", 0.0)) == 1.0
            and float(values.get("propensity_converged", 0.0)) == 1.0
            for values in overlap.values()
        )
        finite = all(math.isfinite(value) for value in estimates.values())
        numerical_valid = bool(common) and finite and converged
        world_results.append(
            {
                "world": config.scenario_name,
                "n_subjects": config.n_subjects,
                "corruption": asdict(corruption),
                "mean_absolute_error": mean_error,
                "max_absolute_error": max_error,
                "coverage_fraction": len(common) / len(truth),
                "numerical_valid": numerical_valid,
                "minimum_arm_ess": min(
                    (
                        min(
                            float(values["treated_ess"]),
                            float(values["control_ess"]),
                        )
                        for values in overlap.values()
                    ),
                    default=0.0,
                ),
                "maximum_extreme_propensity_fraction": max(
                    (
                        float(values["extreme_raw_propensity_fraction"])
                        for values in overlap.values()
                    ),
                    default=1.0,
                ),
            }
        )

    valid = all(bool(result["numerical_valid"]) for result in world_results)
    mean_mae = (
        sum(float(result["mean_absolute_error"]) for result in world_results)
        / len(world_results)
        if valid
        else float("inf")
    )
    return {
        "outcome_l2": outcome_l2,
        "propensity_l2": propensity_l2,
        "numerically_valid": valid,
        "mean_absolute_error": mean_mae,
        "world_results": world_results,
    }


def main() -> None:
    candidates = [
        _evaluate_pair(outcome_l2, propensity_l2)
        for outcome_l2 in OUTCOME_GRID
        for propensity_l2 in PROPENSITY_GRID
    ]
    selected = min(
        candidates,
        key=lambda result: (
            float(result["mean_absolute_error"]),
            -float(result["outcome_l2"]) - float(result["propensity_l2"]),
        ),
    )
    payload = {
        "stage": "DEVELOPMENT",
        "candidate_id": "candidate2-aipw-dr-observable",
        "candidate_version": "1.0.0",
        "selection_rule": (
            "lowest unweighted mean channel-effect MAE across six preregistered "
            "development worlds among numerically valid pairs; ties within exact "
            "floating ordering favor stronger total L2 regularization"
        ),
        "outcome_l2_grid": list(OUTCOME_GRID),
        "propensity_l2_grid": list(PROPENSITY_GRID),
        "results": candidates,
        "selected_outcome_l2": selected["outcome_l2"],
        "selected_propensity_l2": selected["propensity_l2"],
        "candidate1_holdout_metrics_used_for_tuning": False,
        "frozen_phase1_used_for_tuning": False,
        "candidate2_holdout_used_for_tuning": False,
        "development_worlds": [
            {
                "config": asdict(config),
                "corruption": asdict(corruption),
            }
            for config, corruption in development_worlds()
        ],
    }
    (ROOT / "development_results.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print("CANDIDATE2_DEVELOPMENT_RESULT=" + json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()

from __future__ import annotations

import json
from dataclasses import asdict, replace
from pathlib import Path

from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2_evaluator.isolation import CandidateRunner
from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.config import WorldConfig
from attribution_lab.simulation.generator import generate_world
from phase2_candidate_sdk import DeclaredContext

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "model.py"
RIDGE_GRID = (0.05, 0.2, 1.0)


def _worlds() -> tuple[WorldConfig, ...]:
    exposures = {
        Channel.META: 0.35,
        Channel.GOOGLE_BRAND: 0.20,
        Channel.GOOGLE_NON_BRAND: 0.28,
        Channel.PINTEREST: 0.18,
        Channel.EMAIL: 0.24,
        Channel.ORGANIC: 0.32,
        Channel.DIRECT: 0.30,
        Channel.REFERRAL: 0.12,
    }
    balanced = WorldConfig(
        scenario_name="candidate1-dev-balanced-v1",
        n_subjects=500,
        seed=1101,
        baseline_conversion_probability=0.05,
        channel_exposure_probability=exposures,
        channel_log_odds_effect={
            Channel.META: 0.45,
            Channel.GOOGLE_BRAND: 0.10,
            Channel.GOOGLE_NON_BRAND: 0.30,
            Channel.PINTEREST: 0.15,
            Channel.EMAIL: 0.35,
            Channel.ORGANIC: 0.05,
            Channel.DIRECT: 0.0,
            Channel.REFERRAL: 0.12,
        },
        latent_intent_weight=0.55,
    )
    null_negative = replace(
        balanced,
        scenario_name="candidate1-dev-null-negative-v1",
        seed=1102,
        channel_log_odds_effect={
            **dict(balanced.channel_log_odds_effect),
            Channel.PINTEREST: 0.0,
            Channel.EMAIL: -0.55,
        },
    )
    selection = replace(
        balanced,
        scenario_name="candidate1-dev-observed-selection-stress-v1",
        seed=1103,
        channel_log_odds_effect={
            **dict(balanced.channel_log_odds_effect),
            Channel.META: 0.0,
        },
        selection_strength={Channel.META: 1.5},
    )
    sparse = replace(
        balanced,
        scenario_name="candidate1-dev-sparse-v1",
        n_subjects=120,
        seed=1104,
        channel_exposure_probability={
            channel: max(probability * 0.35, 0.03)
            for channel, probability in exposures.items()
        },
    )
    return balanced, null_negative, selection, sparse


def _source_for_ridge(ridge: float) -> str:
    source = MODEL_PATH.read_text(encoding="utf-8")
    return source.replace("RIDGE_LAMBDA = 0.2", f"RIDGE_LAMBDA = {ridge}")


def _evaluate_ridge(ridge: float) -> dict[str, object]:
    runner = CandidateRunner()
    source = _source_for_ridge(ridge)
    world_results: list[dict[str, object]] = []
    for config in _worlds():
        world = generate_world(config)
        response = runner.execute(
            source,
            to_observable_dataset(world.dataset),
            DeclaredContext(
                stage="DEVELOPMENT",
                scenario_family=config.scenario_name,
                estimand_fingerprint="candidate1-preregistered-estimand",
            ),
        )
        estimates = dict(response.estimates)
        truth = {
            channel.value: value
            for channel, value in world.manifest.incremental_effect_map().items()
        }
        common = sorted(set(estimates) & set(truth))
        errors = [abs(estimates[key] - truth[key]) for key in common]
        lower = dict(response.uncertainty.lower) if response.uncertainty else {}
        upper = dict(response.uncertainty.upper) if response.uncertainty else {}
        interval_coverage = (
            sum(int(lower[key] <= truth[key] <= upper[key]) for key in common)
            / len(common)
            if common and response.uncertainty
            else 0.0
        )
        world_results.append(
            {
                "world": config.scenario_name,
                "n_subjects": config.n_subjects,
                "mean_absolute_error": sum(errors) / len(errors),
                "max_absolute_error": max(errors),
                "interval_coverage_fraction": interval_coverage,
            }
        )
    return {
        "ridge_lambda": ridge,
        "mean_absolute_error": sum(
            float(result["mean_absolute_error"]) for result in world_results
        )
        / len(world_results),
        "world_results": world_results,
    }


def main() -> None:
    candidates = [_evaluate_ridge(ridge) for ridge in RIDGE_GRID]
    selected = min(
        candidates,
        key=lambda result: (
            float(result["mean_absolute_error"]),
            -float(result["ridge_lambda"]),
        ),
    )
    payload = {
        "stage": "DEVELOPMENT",
        "selection_rule": (
            "lowest mean synthetic-effect MAE across preregistered development worlds; "
            "ties favor stronger regularization"
        ),
        "ridge_grid": list(RIDGE_GRID),
        "results": candidates,
        "selected_ridge_lambda": selected["ridge_lambda"],
        "development_worlds": [asdict(config) for config in _worlds()],
    }
    print("CANDIDATE1_DEVELOPMENT_RESULT=" + json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()

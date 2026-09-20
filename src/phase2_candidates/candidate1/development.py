from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict
from pathlib import Path
from statistics import mean

from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2_evaluator.evaluator import evaluate_known_case
from attribution_lab.phase2_evaluator.results import EvaluationStage
from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.config import WorldConfig
from attribution_lab.simulation.generator import generate_world
from phase2_candidates.candidate1.protocol import declaration

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "candidate.py"

GRID = (
    (0.01, 0.03),
    (0.01, 0.05),
    (0.01, 0.10),
    (0.10, 0.03),
    (0.10, 0.05),
    (0.10, 0.10),
    (0.50, 0.03),
    (0.50, 0.05),
    (0.50, 0.10),
)


def _exposure(**updates: float) -> dict[Channel, float]:
    base = {
        Channel.META: 0.32,
        Channel.GOOGLE_BRAND: 0.18,
        Channel.GOOGLE_NON_BRAND: 0.26,
        Channel.PINTEREST: 0.20,
        Channel.EMAIL: 0.25,
        Channel.ORGANIC: 0.32,
        Channel.DIRECT: 0.38,
        Channel.REFERRAL: 0.14,
    }
    for name, value in updates.items():
        base[Channel(name)] = value
    return base


def development_configs() -> tuple[WorldConfig, ...]:
    return (
        WorldConfig(
            scenario_name="candidate1-dev-selection-mild",
            n_subjects=180,
            seed=1101,
            baseline_conversion_probability=0.06,
            channel_exposure_probability=_exposure(meta=0.45),
            channel_log_odds_effect={
                Channel.META: 0.0,
                Channel.GOOGLE_NON_BRAND: 0.45,
                Channel.EMAIL: 0.25,
            },
            selection_strength={Channel.META: 0.8, Channel.EMAIL: 0.35},
            temporal_position={Channel.META: 0.80},
        ),
        WorldConfig(
            scenario_name="candidate1-dev-selection-strong",
            n_subjects=180,
            seed=1102,
            baseline_conversion_probability=0.06,
            channel_exposure_probability=_exposure(meta=0.52),
            channel_log_odds_effect={
                Channel.META: 0.0,
                Channel.GOOGLE_NON_BRAND: 0.45,
            },
            selection_strength={
                Channel.META: 1.8,
                Channel.EMAIL: 0.65,
                Channel.GOOGLE_BRAND: 0.45,
            },
            temporal_position={Channel.META: 0.86},
        ),
        WorldConfig(
            scenario_name="candidate1-dev-positive-effect",
            n_subjects=180,
            seed=1103,
            baseline_conversion_probability=0.05,
            channel_exposure_probability=_exposure(meta=0.45),
            channel_log_odds_effect={
                Channel.META: 0.60,
                Channel.GOOGLE_NON_BRAND: 0.35,
                Channel.EMAIL: 0.20,
            },
            selection_strength={Channel.META: 1.2, Channel.EMAIL: 0.50},
        ),
        WorldConfig(
            scenario_name="candidate1-dev-null-prevalence",
            n_subjects=180,
            seed=1104,
            baseline_conversion_probability=0.05,
            channel_exposure_probability=_exposure(pinterest=0.72),
            channel_log_odds_effect={
                Channel.PINTEREST: 0.0,
                Channel.META: 0.45,
            },
            selection_strength={Channel.PINTEREST: 1.3, Channel.EMAIL: 0.40},
            temporal_position={Channel.PINTEREST: 0.82},
        ),
        WorldConfig(
            scenario_name="candidate1-dev-positivity-stress",
            n_subjects=180,
            seed=1105,
            baseline_conversion_probability=0.05,
            channel_exposure_probability=_exposure(meta=0.82),
            channel_log_odds_effect={
                Channel.META: 0.25,
                Channel.GOOGLE_NON_BRAND: 0.30,
            },
            selection_strength={Channel.META: 2.4, Channel.EMAIL: 0.55},
        ),
    )


def source_for(l2: float, clip: float, bootstrap_reps: int = 100) -> str:
    source = TEMPLATE.read_text(encoding="utf-8")
    source = re.sub(
        r"PROPENSITY_L2 = [0-9.]+",
        f"PROPENSITY_L2 = {l2:.2f}",
        source,
        count=1,
    )
    source = re.sub(
        r"PROPENSITY_CLIP = [0-9.]+",
        f"PROPENSITY_CLIP = {clip:.2f}",
        source,
        count=1,
    )
    source = re.sub(
        r"BOOTSTRAP_REPS = [0-9]+",
        f"BOOTSTRAP_REPS = {bootstrap_reps}",
        source,
        count=1,
    )
    return source


def run_development() -> dict[str, object]:
    worlds = [generate_world(config) for config in development_configs()]
    results: list[dict[str, object]] = []
    for l2, clip in GRID:
        source = source_for(l2, clip)
        decl = declaration(
            propensity_l2=l2,
            propensity_clip=clip,
            bootstrap_reps=100,
        )
        world_records: list[dict[str, object]] = []
        for world in worlds:
            evaluation = evaluate_known_case(
                decl,
                source,
                dataset=to_observable_dataset(world.dataset),
                synthetic_truth=tuple(
                    sorted(
                        (channel.value, value)
                        for channel, value
                        in world.manifest.incremental_effect_map().items()
                    )
                ),
                stage=EvaluationStage.DEVELOPMENT,
                family=world.manifest.scenario_name,
            )
            metrics = dict(evaluation.metrics)
            world_records.append(
                {
                    "world": world.manifest.scenario_name,
                    "status": evaluation.status.value,
                    "metrics": metrics,
                    "uncertainty_present": evaluation.uncertainty_present,
                }
            )
        maes = [
            float(record["metrics"]["mean_absolute_error"])
            for record in world_records
            if record["status"] == "evaluated"
        ]
        mean_mae = mean(maes) if len(maes) == len(world_records) else float("inf")
        results.append(
            {
                "propensity_l2": l2,
                "propensity_clip": clip,
                "mean_mae": mean_mae,
                "worlds": world_records,
            }
        )

    ordered = sorted(
        results,
        key=lambda item: (
            float(item["mean_mae"]),
            -float(item["propensity_l2"]),
            -float(item["propensity_clip"]),
        ),
    )
    return {
        "stage": "DEVELOPMENT",
        "selection_rule": (
            "lowest mean development MAE; ties -> stronger regularization, wider clip"
        ),
        "grid": results,
        "selected": ordered[0],
        "world_usage": [asdict(config) for config in development_configs()],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    payload = run_development()
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n",
        encoding="utf-8",
    )
    selected = payload["selected"]
    print(
        "DEVELOPMENT selected "
        f"l2={selected['propensity_l2']} clip={selected['propensity_clip']} "
        f"mean_mae={selected['mean_mae']:.6f}"
    )


if __name__ == "__main__":
    main()

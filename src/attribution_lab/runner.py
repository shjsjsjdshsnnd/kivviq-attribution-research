from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

from attribution_lab.evaluation.metrics import evaluate_result
from attribution_lab.models import (
    AttributionModel,
    FirstTouchModel,
    LastPaidTouchModel,
    LastTouchModel,
    LinearModel,
    MarkovRemovalModel,
    PositionBasedModel,
    ShapleyAttributionModel,
    TimeDecayModel,
)
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world
from attribution_lab.stress.corruption import CorruptionConfig, corrupt_world


@dataclass(frozen=True, slots=True)
class ExperimentSpec:
    scenario: str
    seed: int
    sample_size: int
    observation_quality: str


def model_factories() -> dict[str, Callable[[], AttributionModel]]:
    return {
        "first_touch": FirstTouchModel,
        "last_touch": LastTouchModel,
        "last_paid_touch": LastPaidTouchModel,
        "linear": LinearModel,
        "time_decay": TimeDecayModel,
        "position_based": PositionBasedModel,
        "markov_removal": MarkovRemovalModel,
        "shapley": ShapleyAttributionModel,
    }


def corruption_for_quality(name: str) -> CorruptionConfig:
    if name == "perfect":
        return CorruptionConfig()
    if name == "missing_10":
        return CorruptionConfig(random_missing_touch_probability=0.10)
    if name == "missing_25":
        return CorruptionConfig(random_missing_touch_probability=0.25)
    if name == "missing_50":
        return CorruptionConfig(random_missing_touch_probability=0.50)
    if name == "fragmented_identity":
        return CorruptionConfig(
            identity_fragmentation_probability=0.35,
            cross_device_fragmentation_probability=0.25,
            cookie_loss_probability=0.20,
        )
    raise ValueError(f"unknown observation quality: {name}")


def run_experiment(spec: ExperimentSpec) -> list[dict[str, object]]:
    config = scenario_config(spec.scenario, seed=spec.seed, n_subjects=spec.sample_size)
    pristine = generate_world(config)
    corruption = corruption_for_quality(spec.observation_quality)
    observed = corrupt_world(pristine, corruption, seed=spec.seed + 10_000)
    records: list[dict[str, object]] = []

    for model_name, factory in model_factories().items():
        result = factory().attribute(observed.dataset.journeys)
        records.append(
            {
                "spec": asdict(spec),
                "model": model_name,
                "channel_credit": {
                    channel.value: value for channel, value in result.channel_credit.items()
                },
                "diagnostics": result.diagnostics,
                "metrics": evaluate_result(result, observed.manifest),
                "manifest_digest": observed.manifest.digest,
                "ground_truth_manifest": observed.manifest.as_dict(),
            }
        )
    return records


def benchmark_specs(*, quick: bool) -> list[ExperimentSpec]:
    sample_size = 140 if quick else 1000
    seeds = [17] if quick else [7, 17, 29, 41]
    scenario_quality_pairs = [
        ("simple_single_touch", "perfect"),
        ("balanced_multi_touch", "perfect"),
        ("strong_first_touch", "perfect"),
        ("strong_final_touch", "perfect"),
        ("brand_search_capture", "perfect"),
        ("retargeting_selection", "perfect"),
        ("null_paid_channel", "perfect"),
        ("interaction_effect", "perfect"),
        ("balanced_multi_touch", "fragmented_identity"),
        ("balanced_multi_touch", "missing_10"),
        ("balanced_multi_touch", "missing_25"),
        ("balanced_multi_touch", "missing_50"),
    ]
    return [
        ExperimentSpec(scenario, seed, sample_size, quality)
        for seed in seeds
        for scenario, quality in scenario_quality_pairs
    ]


def run_benchmark(*, quick: bool = False) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for spec in benchmark_specs(quick=quick):
        records.extend(run_experiment(spec))
    return records


def write_outputs(records: list[dict[str, object]], output: str | Path) -> None:
    directory = Path(output)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "results.json").write_text(
        json.dumps(records, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    manifests: dict[str, object] = {}
    for record in records:
        digest = record.get("manifest_digest")
        manifest = record.get("ground_truth_manifest")
        if isinstance(digest, str) and manifest is not None:
            manifests[digest] = manifest
    (directory / "ground_truth_manifests.json").write_text(
        json.dumps(manifests, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    lines = [
        "# Synthetic Attribution Benchmark",
        "",
        "These are behavioral observations under declared synthetic worlds.",
        "They are not real-world causal accuracy claims and do not establish an overall winner.",
        "",
        f"Experiment-model records: {len(records)}",
        "",
        "| Scenario | Quality | Model | L1 synthetic recovery |",
        "| --- | --- | --- | ---: |",
    ]
    for record in records:
        spec = record["spec"]
        metrics = record["metrics"]
        if not isinstance(spec, dict) or not isinstance(metrics, dict):
            continue
        lines.append(
            "| {scenario} | {quality} | {model} | {score:.4f} |".format(
                scenario=spec["scenario"],
                quality=spec["observation_quality"],
                model=record["model"],
                score=float(metrics["synthetic_causal_recovery_l1"]),
            )
        )
    (directory / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--output", default="benchmark_output")
    args = parser.parse_args()
    records = run_benchmark(quick=args.quick)
    write_outputs(records, args.output)


if __name__ == "__main__":
    main()

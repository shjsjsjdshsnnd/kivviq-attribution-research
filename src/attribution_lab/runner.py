from __future__ import annotations

import argparse
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from typing import Any

from attribution_lab.evaluation.analysis import (
    annotate_comparative_metrics,
    write_analysis_artifacts,
)
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
from attribution_lab.schemas.core import Channel, ConsentState, Dataset
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import SyntheticWorld, generate_world
from attribution_lab.stress.corruption import CorruptionConfig, corrupt_world

MODEL_NAMES = (
    "first_touch",
    "last_touch",
    "last_paid_touch",
    "linear",
    "time_decay",
    "position_based",
    "markov_removal",
    "shapley",
)

FULL_SCENARIOS = (
    "simple_single_touch",
    "balanced_multi_touch",
    "strong_first_touch",
    "strong_final_touch",
    "pure_acquisition",
    "demand_capture",
    "retargeting_selection",
    "assisted_conversion",
    "channel_interaction",
    "organic_direct_return",
    "null_paid_channel",
    "harmful_channel",
    "null_channel_high_prevalence",
    "null_channel_last_touch",
    "null_channel_high_intent",
    "null_channel_retargeting",
    "balanced_short_journeys",
    "balanced_long_journeys",
    "balanced_rare_channels",
    "balanced_common_channels",
)

OBSERVATION_QUALITIES = (
    "perfect",
    "missing_10",
    "missing_25",
    "missing_50",
    "channel_specific_missing",
    "fragmented_identity",
    "missing_click_ids",
    "utm_corruption",
    "utm_removal",
    "cookie_loss",
    "session_splitting",
    "delayed_events",
    "duplicated_events",
    "consent_exclusions",
    "observation_censoring",
)

RESEARCH_SEEDS = (7, 17, 29, 41, 73)
RESEARCH_SAMPLE_SIZES = (80, 250, 800)


@dataclass(frozen=True, slots=True)
class ExperimentSpec:
    scenario: str
    seed: int
    sample_size: int
    observation_quality: str


def model_factories() -> dict[str, Callable[[], AttributionModel]]:
    factories: dict[str, Callable[[], AttributionModel]] = {
        "first_touch": FirstTouchModel,
        "last_touch": LastTouchModel,
        "last_paid_touch": LastPaidTouchModel,
        "linear": LinearModel,
        "time_decay": TimeDecayModel,
        "position_based": PositionBasedModel,
        "markov_removal": MarkovRemovalModel,
        "shapley": ShapleyAttributionModel,
    }
    if tuple(factories) != MODEL_NAMES:
        raise RuntimeError("Phase 1 baseline model registry changed")
    return factories


def corruption_for_quality(name: str) -> CorruptionConfig:
    if name == "perfect":
        return CorruptionConfig()
    if name == "missing_10":
        return CorruptionConfig(random_missing_touch_probability=0.10)
    if name == "missing_25":
        return CorruptionConfig(random_missing_touch_probability=0.25)
    if name == "missing_50":
        return CorruptionConfig(random_missing_touch_probability=0.50)
    if name == "channel_specific_missing":
        return CorruptionConfig(channel_missing_probability={Channel.META: 0.50})
    if name == "fragmented_identity":
        return CorruptionConfig(
            identity_fragmentation_probability=0.45,
            cross_device_fragmentation_probability=0.25,
        )
    if name == "missing_click_ids":
        return CorruptionConfig(missing_click_id_probability=0.80)
    if name == "utm_corruption":
        return CorruptionConfig(corrupted_utm_probability=0.80)
    if name == "utm_removal":
        return CorruptionConfig(missing_utm_probability=0.80)
    if name == "cookie_loss":
        return CorruptionConfig(cookie_loss_probability=0.50)
    if name == "session_splitting":
        return CorruptionConfig(session_splitting_probability=0.65)
    if name == "delayed_events":
        return CorruptionConfig(delayed_event_probability=0.40, delay_hours=96.0)
    if name == "duplicated_events":
        return CorruptionConfig(duplicate_event_probability=0.40)
    if name == "consent_exclusions":
        return CorruptionConfig(consent_exclusion_probability=0.25)
    if name == "observation_censoring":
        return CorruptionConfig(censor_probability=0.35)
    raise ValueError(f"unknown observation quality: {name}")


def _dataset_summary(dataset: Dataset) -> dict[str, Any]:
    journeys = dataset.journeys
    count = len(journeys)
    denominator = max(count, 1)
    touch_counts = [len(journey.ordered_touchpoints()) for journey in journeys]
    session_counts = [len(journey.sessions) for journey in journeys]
    channel_presence = {
        channel.value: sum(
            int(channel in {touch.channel for touch in journey.ordered_touchpoints()})
            for journey in journeys
        )
        / denominator
        for channel in Channel
    }
    return {
        "journeys": count,
        "purchasers": len(dataset.purchasers()),
        "completed_non_purchasers": len(dataset.completed_non_purchasers()),
        "mean_touchpoints": sum(touch_counts) / denominator,
        "mean_sessions": sum(session_counts) / denominator,
        "mean_identity_confidence": (
            sum(journey.identity_confidence for journey in journeys) / denominator
        ),
        "censored_fraction": sum(int(journey.is_censored) for journey in journeys)
        / denominator,
        "consent_excluded_fraction": sum(
            int(journey.consent_state == ConsentState.DENIED) for journey in journeys
        )
        / denominator,
        "channel_prevalence": channel_presence,
    }


def _quality_seed(spec: ExperimentSpec) -> int:
    try:
        quality_index = OBSERVATION_QUALITIES.index(spec.observation_quality)
    except ValueError:
        quality_index = 0
    return spec.seed + 10_000 + quality_index * 1_009


def _evaluate_world(
    observed: SyntheticWorld,
    spec: ExperimentSpec,
    *,
    include_manifest: bool,
) -> list[dict[str, Any]]:
    summary = _dataset_summary(observed.dataset)
    records: list[dict[str, Any]] = []
    for model_index, (model_name, factory) in enumerate(model_factories().items()):
        result = factory().attribute(observed.dataset.journeys)
        record: dict[str, Any] = {
            "spec": asdict(spec),
            "model": model_name,
            "channel_credit": {
                channel.value: value for channel, value in result.channel_credit.items()
            },
            "diagnostics": result.diagnostics,
            "metrics": evaluate_result(result, observed.manifest),
            "dataset_summary": summary,
            "manifest_digest": observed.manifest.digest,
        }
        if include_manifest and model_index == 0:
            record["ground_truth_manifest"] = observed.manifest.as_dict()
        records.append(record)
    return records


def run_experiment(spec: ExperimentSpec) -> list[dict[str, Any]]:
    pristine = generate_world(
        scenario_config(spec.scenario, seed=spec.seed, n_subjects=spec.sample_size)
    )
    observed = corrupt_world(
        pristine,
        corruption_for_quality(spec.observation_quality),
        seed=_quality_seed(spec),
    )
    records = _evaluate_world(observed, spec, include_manifest=True)
    annotate_comparative_metrics(records)
    return records


def quick_benchmark_specs() -> list[ExperimentSpec]:
    specs = [
        ExperimentSpec(scenario, 17, 120, "perfect")
        for scenario in FULL_SCENARIOS
    ]
    specs.extend(
        ExperimentSpec("balanced_multi_touch", 17, 120, quality)
        for quality in OBSERVATION_QUALITIES
        if quality != "perfect"
    )
    return specs


def full_benchmark_specs() -> list[ExperimentSpec]:
    return [
        ExperimentSpec(scenario, seed, sample_size, quality)
        for scenario in FULL_SCENARIOS
        for seed in RESEARCH_SEEDS
        for sample_size in RESEARCH_SAMPLE_SIZES
        for quality in OBSERVATION_QUALITIES
    ]


def benchmark_specs(*, quick: bool) -> list[ExperimentSpec]:
    return quick_benchmark_specs() if quick else full_benchmark_specs()


def _group_specs(
    specs: Iterable[ExperimentSpec],
) -> dict[tuple[str, int, int], list[ExperimentSpec]]:
    grouped: dict[tuple[str, int, int], list[ExperimentSpec]] = defaultdict(list)
    for spec in specs:
        grouped[(spec.scenario, spec.seed, spec.sample_size)].append(spec)
    return grouped


def run_specs(specs: Iterable[ExperimentSpec]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for (scenario, seed, sample_size), group in _group_specs(specs).items():
        pristine = generate_world(
            scenario_config(scenario, seed=seed, n_subjects=sample_size)
        )
        ordered_group = sorted(
            group,
            key=lambda spec: OBSERVATION_QUALITIES.index(spec.observation_quality),
        )
        for quality_index, spec in enumerate(ordered_group):
            observed = corrupt_world(
                pristine,
                corruption_for_quality(spec.observation_quality),
                seed=_quality_seed(spec),
            )
            records.extend(
                _evaluate_world(
                    observed,
                    spec,
                    include_manifest=quality_index == 0,
                )
            )
    annotate_comparative_metrics(records)
    return records


def run_benchmark(*, quick: bool = False) -> list[dict[str, Any]]:
    return run_specs(benchmark_specs(quick=quick))


def write_outputs(records: list[dict[str, Any]], output: str) -> None:
    write_analysis_artifacts(records, output)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--output", default="benchmark_output")
    args = parser.parse_args()
    records = run_benchmark(quick=args.quick)
    write_outputs(records, args.output)


if __name__ == "__main__":
    main()

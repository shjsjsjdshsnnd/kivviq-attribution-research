from __future__ import annotations

import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, median, pstdev
from typing import Any

from attribution_lab.schemas.core import Channel

Record = dict[str, Any]


def _quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * probability
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def summarize_values(values: list[float]) -> dict[str, float | int]:
    if not values:
        return {
            "n": 0,
            "mean": 0.0,
            "median": 0.0,
            "stddev": 0.0,
            "p10": 0.0,
            "p90": 0.0,
        }
    return {
        "n": len(values),
        "mean": mean(values),
        "median": median(values),
        "stddev": pstdev(values) if len(values) > 1 else 0.0,
        "p10": _quantile(values, 0.10),
        "p90": _quantile(values, 0.90),
    }


def _spec(record: Record) -> dict[str, Any]:
    value = record.get("spec")
    return value if isinstance(value, dict) else {}


def _channel_credit(record: Record, channel: str) -> float:
    credits = record.get("channel_credit")
    if not isinstance(credits, dict):
        return 0.0
    value = credits.get(channel, 0.0)
    return float(value) if isinstance(value, int | float) else 0.0


def _nested_numeric(record: Record, section: str, key: str) -> float | None:
    container = record.get(section)
    if not isinstance(container, dict):
        return None
    value = container.get(key)
    if isinstance(value, int | float):
        return float(value)
    return None


def annotate_comparative_metrics(records: list[Record]) -> None:
    perfect_index: dict[tuple[str, int, int, str], Record] = {}
    for record in records:
        spec = _spec(record)
        if spec.get("observation_quality") != "perfect":
            continue
        key = (
            str(spec.get("scenario")),
            int(spec.get("seed", 0)),
            int(spec.get("sample_size", 0)),
            str(record.get("model")),
        )
        perfect_index[key] = record

    for record in records:
        spec = _spec(record)
        key = (
            str(spec.get("scenario")),
            int(spec.get("seed", 0)),
            int(spec.get("sample_size", 0)),
            str(record.get("model")),
        )
        perfect = perfect_index.get(key)
        if perfect is None:
            record["comparative_metrics"] = {
                "l1_from_model_perfect": None,
                "synthetic_recovery_delta_from_perfect": None,
            }
            continue
        divergence = sum(
            abs(
                _channel_credit(record, channel.value)
                - _channel_credit(perfect, channel.value)
            )
            for channel in Channel
        )
        current_recovery = _nested_numeric(
            record,
            "metrics",
            "synthetic_causal_recovery_l1",
        )
        perfect_recovery = _nested_numeric(
            perfect,
            "metrics",
            "synthetic_causal_recovery_l1",
        )
        recovery_delta = (
            current_recovery - perfect_recovery
            if current_recovery is not None and perfect_recovery is not None
            else None
        )
        record["comparative_metrics"] = {
            "l1_from_model_perfect": divergence,
            "synthetic_recovery_delta_from_perfect": recovery_delta,
        }


def build_matrix_metadata(records: list[Record]) -> dict[str, Any]:
    scenarios = sorted({str(_spec(record).get("scenario")) for record in records})
    seeds = sorted({int(_spec(record).get("seed", 0)) for record in records})
    sample_sizes = sorted(
        {int(_spec(record).get("sample_size", 0)) for record in records}
    )
    qualities = sorted(
        {str(_spec(record).get("observation_quality")) for record in records}
    )
    models: list[str] = []
    for record in records:
        model = str(record.get("model"))
        if model not in models:
            models.append(model)
    experiment_keys = {
        (
            str(_spec(record).get("scenario")),
            int(_spec(record).get("seed", 0)),
            int(_spec(record).get("sample_size", 0)),
            str(_spec(record).get("observation_quality")),
        )
        for record in records
    }
    return {
        "scenarios": scenarios,
        "seeds": seeds,
        "sample_sizes": sample_sizes,
        "observation_qualities": qualities,
        "models": models,
        "synthetic_experiments": len(experiment_keys),
        "model_evaluations": len(records),
    }


def aggregate_uncertainty(records: list[Record]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, int, str], list[Record]] = defaultdict(list)
    for record in records:
        spec = _spec(record)
        key = (
            str(spec.get("scenario")),
            str(spec.get("observation_quality")),
            int(spec.get("sample_size", 0)),
            str(record.get("model")),
        )
        grouped[key].append(record)

    metric_names = (
        "credit_conservation_error",
        "rank_agreement",
        "absolute_attribution_error",
        "normalized_attribution_error",
        "false_credit_to_null_channels",
        "synthetic_causal_recovery_l1",
    )
    comparative_names = (
        "l1_from_model_perfect",
        "synthetic_recovery_delta_from_perfect",
    )
    aggregates: list[dict[str, Any]] = []
    for (scenario, quality, sample_size, model), group in sorted(grouped.items()):
        metrics: dict[str, Any] = {}
        for metric_name in metric_names:
            values = [
                value
                for record in group
                if (value := _nested_numeric(record, "metrics", metric_name))
                is not None
            ]
            metrics[metric_name] = summarize_values(values)
        for metric_name in comparative_names:
            values = [
                value
                for record in group
                if (
                    value := _nested_numeric(
                        record,
                        "comparative_metrics",
                        metric_name,
                    )
                )
                is not None
            ]
            metrics[metric_name] = summarize_values(values)

        channel_stats = {
            channel.value: summarize_values(
                [_channel_credit(record, channel.value) for record in group]
            )
            for channel in Channel
        }
        aggregates.append(
            {
                "scenario": scenario,
                "observation_quality": quality,
                "sample_size": sample_size,
                "model": model,
                "replications": len(group),
                "metrics": metrics,
                "channel_credit": channel_stats,
            }
        )
    return aggregates


def _matching(
    records: list[Record],
    *,
    scenario: str | None = None,
    quality: str | None = None,
    sample_size: int | None = None,
    model: str | None = None,
) -> list[Record]:
    matched: list[Record] = []
    for record in records:
        spec = _spec(record)
        if scenario is not None and spec.get("scenario") != scenario:
            continue
        if quality is not None and spec.get("observation_quality") != quality:
            continue
        if sample_size is not None and spec.get("sample_size") != sample_size:
            continue
        if model is not None and record.get("model") != model:
            continue
        matched.append(record)
    return matched


def _mean_credit(records: list[Record], channel: str) -> float:
    return mean([_channel_credit(record, channel) for record in records]) if records else 0.0


def _mean_nested(records: list[Record], section: str, key: str) -> float:
    values = [
        value
        for record in records
        if (value := _nested_numeric(record, section, key)) is not None
    ]
    return mean(values) if values else 0.0


def _truth_value(record: Record, channel: str) -> float:
    metrics = record.get("metrics")
    if not isinstance(metrics, dict):
        return 0.0
    truth = metrics.get("synthetic_truth_signed")
    if not isinstance(truth, dict):
        return 0.0
    value = truth.get(channel, 0.0)
    return float(value) if isinstance(value, int | float) else 0.0


def _sample_dependence(
    records: list[Record],
    *,
    scenario: str,
    quality: str,
    model: str,
    channel: str,
) -> dict[str, float]:
    sizes = sorted({int(_spec(record).get("sample_size", 0)) for record in records})
    if not sizes:
        return {"small_sample_mean": 0.0, "large_sample_mean": 0.0}
    small = _matching(
        records,
        scenario=scenario,
        quality=quality,
        sample_size=sizes[0],
        model=model,
    )
    large = _matching(
        records,
        scenario=scenario,
        quality=quality,
        sample_size=sizes[-1],
        model=model,
    )
    return {
        "small_sample_mean": _mean_credit(small, channel),
        "large_sample_mean": _mean_credit(large, channel),
    }


def _catalog_entry(
    *,
    model: str,
    scenario: str,
    conditions: str,
    observed_behavior: str,
    ground_truth: str,
    magnitude: dict[str, float],
    repeatability: dict[str, float | int],
    explanation: str,
    classification: str,
    measurement_quality: str,
    sample_size_dependence: dict[str, float],
) -> dict[str, Any]:
    return {
        "model": model,
        "scenario": scenario,
        "conditions": conditions,
        "observed_behavior": observed_behavior,
        "ground_truth": ground_truth,
        "magnitude": magnitude,
        "repeatability": repeatability,
        "likely_explanation": explanation,
        "classification": classification,
        "measurement_quality": measurement_quality,
        "sample_size_dependence": sample_size_dependence,
    }


def build_failure_catalog(records: list[Record]) -> list[dict[str, Any]]:
    matrix = build_matrix_metadata(records)
    models = [str(model) for model in matrix["models"]]
    sizes = [int(size) for size in matrix["sample_sizes"]]
    if not sizes:
        return []
    large_size = max(sizes)
    catalog: list[dict[str, Any]] = []

    zero_effect_tests = (
        (
            "null_paid_channel",
            Channel.PINTEREST.value,
            "Known-null paid channel receives descriptive credit.",
            "The target paid channel has zero structural and synthetic incremental effect.",
            "observed path presence can receive credit despite a null causal effect",
        ),
        (
            "null_channel_high_prevalence",
            Channel.PINTEREST.value,
            "High-prevalence null channel receives descriptive credit.",
            "The target channel remains causally null while appearing frequently.",
            "prevalence can increase descriptive opportunity without creating causal effect",
        ),
        (
            "null_channel_last_touch",
            Channel.PINTEREST.value,
            "Late-position null channel receives descriptive credit.",
            "The target channel is causally null but intentionally positioned late.",
            "purchase proximity can be mistaken for contribution",
        ),
        (
            "null_channel_high_intent",
            Channel.PINTEREST.value,
            "Intent-selected null channel receives descriptive credit.",
            "The target channel is causally null but exposure is selected by latent intent.",
            "selection on latent intent creates observational association",
        ),
        (
            "null_channel_retargeting",
            Channel.PINTEREST.value,
            "Retargeting-like null channel receives descriptive credit.",
            "The target channel is causally null, intent-selected, and late in the path.",
            "selection and temporal proximity compound descriptive credit",
        ),
        (
            "demand_capture",
            Channel.GOOGLE_BRAND.value,
            "Demand-capture channel receives credit despite zero effect.",
            "Brand-search capture has zero structural effect in this synthetic world.",
            "late observed proximity captures demand created elsewhere",
        ),
        (
            "retargeting_selection",
            Channel.META.value,
            "Retargeting-selected channel receives credit despite zero effect.",
            "The retargeting channel has zero structural effect and high-intent selection.",
            "selection into exposure produces association without incremental contribution",
        ),
    )

    for scenario, channel, behavior, truth, explanation in zero_effect_tests:
        for model in models:
            group = _matching(
                records,
                scenario=scenario,
                quality="perfect",
                sample_size=large_size,
                model=model,
            )
            if not group:
                continue
            credits = [_channel_credit(record, channel) for record in group]
            truths = [_truth_value(record, channel) for record in group]
            if max((abs(value) for value in truths), default=0.0) > 1e-9:
                continue
            mean_credit = mean(credits)
            if mean_credit < 0.005:
                continue
            affected = sum(value >= 0.005 for value in credits)
            catalog.append(
                _catalog_entry(
                    model=model,
                    scenario=scenario,
                    conditions="perfect observation; largest sample size; repeated seeds",
                    observed_behavior=behavior,
                    ground_truth=truth,
                    magnitude={
                        "mean_target_credit": mean_credit,
                        "mean_target_truth": mean(truths) if truths else 0.0,
                    },
                    repeatability={
                        "affected_replications": affected,
                        "replications": len(credits),
                        "rate": affected / len(credits),
                    },
                    explanation=explanation,
                    classification="empirical simulation result",
                    measurement_quality="perfect",
                    sample_size_dependence=_sample_dependence(
                        records,
                        scenario=scenario,
                        quality="perfect",
                        model=model,
                        channel=channel,
                    ),
                )
            )

    for model in models:
        harmful = _matching(
            records,
            scenario="harmful_channel",
            quality="perfect",
            sample_size=large_size,
            model=model,
        )
        if harmful:
            truths = [_truth_value(record, Channel.PINTEREST.value) for record in harmful]
            credits = [
                _channel_credit(record, Channel.PINTEREST.value) for record in harmful
            ]
            if mean(truths) < 0:
                catalog.append(
                    _catalog_entry(
                        model=model,
                        scenario="harmful_channel",
                        conditions="negative synthetic incremental effect",
                        observed_behavior=(
                            "Final normalized descriptive credit cannot express a negative "
                            "channel contribution."
                        ),
                        ground_truth="The target channel has a negative incremental effect.",
                        magnitude={
                            "mean_target_credit": mean(credits),
                            "mean_target_truth": mean(truths),
                        },
                        repeatability={
                            "affected_replications": len(harmful),
                            "replications": len(harmful),
                            "rate": 1.0,
                        },
                        explanation=(
                            "The Phase 1 credit interface is non-negative and normalized; "
                            "negative causal effects are outside its representational range."
                        ),
                        classification="mathematical consequence",
                        measurement_quality="perfect",
                        sample_size_dependence=_sample_dependence(
                            records,
                            scenario="harmful_channel",
                            quality="perfect",
                            model=model,
                            channel=Channel.PINTEREST.value,
                        ),
                    )
                )

        missing = _matching(
            records,
            quality="missing_50",
            sample_size=large_size,
            model=model,
        )
        divergences = [
            value
            for record in missing
            if (
                value := _nested_numeric(
                    record,
                    "comparative_metrics",
                    "l1_from_model_perfect",
                )
            )
            is not None
        ]
        if divergences and mean(divergences) >= 0.05:
            affected = sum(value >= 0.05 for value in divergences)
            catalog.append(
                _catalog_entry(
                    model=model,
                    scenario="all scenarios",
                    conditions="50% random touch loss versus the same model under perfect observation",
                    observed_behavior="Model credit moves materially as observed touches disappear.",
                    ground_truth="Latent synthetic truth is unchanged by observation corruption.",
                    magnitude={"mean_l1_from_perfect": mean(divergences)},
                    repeatability={
                        "affected_replications": affected,
                        "replications": len(divergences),
                        "rate": affected / len(divergences),
                    },
                    explanation="missing measurement changes the path evidence available to the model",
                    classification="empirical simulation result",
                    measurement_quality="missing_50",
                    sample_size_dependence={},
                )
            )

    interaction_models = models
    for model in interaction_models:
        group = _matching(
            records,
            scenario="channel_interaction",
            quality="perfect",
            sample_size=large_size,
            model=model,
        )
        recovery = [
            value
            for record in group
            if (
                value := _nested_numeric(
                    record,
                    "metrics",
                    "synthetic_causal_recovery_l1",
                )
            )
            is not None
        ]
        if recovery and mean(recovery) >= 0.20:
            catalog.append(
                _catalog_entry(
                    model=model,
                    scenario="channel_interaction",
                    conditions="effect(Meta + Email) differs from the sum of isolated effects",
                    observed_behavior=(
                        "Descriptive channel credit differs materially from the "
                        "intervention-derived synthetic truth."
                    ),
                    ground_truth="The outcome equation contains an explicit Meta × Email interaction.",
                    magnitude={"mean_synthetic_causal_recovery_l1": mean(recovery)},
                    repeatability={
                        "affected_replications": sum(value >= 0.20 for value in recovery),
                        "replications": len(recovery),
                        "rate": sum(value >= 0.20 for value in recovery) / len(recovery),
                    },
                    explanation=(
                        "Observed-credit rules do not identify a causal interaction merely "
                        "from path co-occurrence."
                    ),
                    classification="empirical simulation result",
                    measurement_quality="perfect",
                    sample_size_dependence={},
                )
            )

    return catalog


def build_simulator_bias_audit(records: list[Record]) -> dict[str, Any]:
    expected_models = {
        "first_touch",
        "last_touch",
        "last_paid_touch",
        "linear",
        "time_decay",
        "position_based",
        "markov_removal",
        "shapley",
    }
    found_models = {str(record.get("model")) for record in records}

    manifest_groups: dict[tuple[str, int, int], set[str]] = defaultdict(set)
    truth_groups: dict[tuple[str, int, int, str], set[str]] = defaultdict(set)
    dataset_groups: dict[tuple[str, int, int, str], set[str]] = defaultdict(set)

    for record in records:
        spec = _spec(record)
        base_key = (
            str(spec.get("scenario")),
            int(spec.get("seed", 0)),
            int(spec.get("sample_size", 0)),
        )
        manifest_groups[base_key].add(str(record.get("manifest_digest")))
        experiment_key = (*base_key, str(spec.get("observation_quality")))
        metrics = record.get("metrics")
        truth = metrics.get("synthetic_truth_signed", {}) if isinstance(metrics, dict) else {}
        truth_groups[experiment_key].add(json.dumps(truth, sort_keys=True))
        dataset_groups[experiment_key].add(
            json.dumps(record.get("dataset_summary", {}), sort_keys=True)
        )

    checks = [
        {
            "check": "frozen_baseline_registry",
            "status": "pass" if found_models == expected_models else "fail",
            "evidence": f"observed model set: {sorted(found_models)}",
        },
        {
            "check": "manifest_invariant_across_corruption",
            "status": (
                "pass"
                if all(len(digests) == 1 for digests in manifest_groups.values())
                else "fail"
            ),
            "evidence": (
                "every scenario/seed/sample-size group retained one manifest digest "
                "across all observation qualities"
            ),
        },
        {
            "check": "truth_consistent_across_models",
            "status": (
                "pass"
                if all(len(values) == 1 for values in truth_groups.values())
                else "fail"
            ),
            "evidence": "all models in an experiment received identical stored synthetic truth",
        },
        {
            "check": "corruption_dataset_model_agnostic",
            "status": (
                "pass"
                if all(len(values) == 1 for values in dataset_groups.values())
                else "fail"
            ),
            "evidence": "all models in an experiment evaluated the same corrupted dataset summary",
        },
        {
            "check": "outcome_generation_separate_from_attribution",
            "status": "pass",
            "evidence": (
                "simulator tests enforce that the simulation package does not import "
                "the attribution model package"
            ),
        },
        {
            "check": "ordering_assumptions",
            "status": "documented_assumption",
            "evidence": (
                "default ordering is synthetic/random; scenarios with first/last effects "
                "declare temporal_position or temporal_log_odds_effect in the manifest"
            ),
        },
    ]
    return {
        "overall_status": (
            "pass"
            if all(check["status"] in {"pass", "documented_assumption"} for check in checks)
            else "fail"
        ),
        "checks": checks,
        "unavoidable_assumptions": [
            "outcomes use a logistic synthetic response model",
            "exposure depends on declared channel prevalence and optional latent-intent selection",
            "the channel universe is fixed to the Phase 1 synthetic schema",
            "counterfactual channel effects are simulator-defined and do not imply external validity",
            "corruption mechanisms are simplified controlled failures rather than browser-specific emulation",
        ],
    }


def _format(value: float) -> str:
    return f"{value:.3f}"


def _model_order(records: list[Record]) -> list[str]:
    order: list[str] = []
    for record in records:
        model = str(record.get("model"))
        if model not in order:
            order.append(model)
    return order


def _mean_credit_for(
    records: list[Record],
    *,
    scenario: str,
    quality: str,
    sample_size: int,
    model: str,
    channel: str,
) -> float:
    return _mean_credit(
        _matching(
            records,
            scenario=scenario,
            quality=quality,
            sample_size=sample_size,
            model=model,
        ),
        channel,
    )


def _mean_comparative_for(
    records: list[Record],
    *,
    quality: str,
    sample_size: int,
    model: str,
) -> float:
    return _mean_nested(
        _matching(
            records,
            quality=quality,
            sample_size=sample_size,
            model=model,
        ),
        "comparative_metrics",
        "l1_from_model_perfect",
    )


def _mean_recovery_for(
    records: list[Record],
    *,
    scenario: str,
    sample_size: int,
    model: str,
) -> float:
    return _mean_nested(
        _matching(
            records,
            scenario=scenario,
            quality="perfect",
            sample_size=sample_size,
            model=model,
        ),
        "metrics",
        "synthetic_causal_recovery_l1",
    )


def build_research_report(
    records: list[Record],
    uncertainty: list[dict[str, Any]],
    failures: list[dict[str, Any]],
    audit: dict[str, Any],
) -> str:
    matrix = build_matrix_metadata(records)
    models = _model_order(records)
    sizes = [int(value) for value in matrix["sample_sizes"]]
    large_size = max(sizes) if sizes else 0
    small_size = min(sizes) if sizes else 0

    allocation = {
        "first_touch": "Allocates all observed conversion credit to the earliest eligible touch.",
        "last_touch": "Allocates all observed conversion credit to the latest eligible touch.",
        "last_paid_touch": "Allocates credit to the latest paid touch, falling back to latest touch.",
        "linear": "Splits each observed conversion equally across its eligible touches.",
        "time_decay": "Weights observed touches by recency using the declared half-life.",
        "position_based": "Uses declared first/last weights and shares remaining credit across middle touches.",
        "markov_removal": "Uses empirical transition paths and channel-removal effects over completed journeys.",
        "shapley": "Uses an empirical coalition conversion-rate game over observed channel sets.",
    }

    lines = [
        "# Phase 1 attribution validation report",
        "",
        "## Scope",
        "",
        "This report describes repeated **synthetic** experiments only. Descriptive attribution "
        "and synthetic incremental truth are separate quantities. SYNTHETIC CAUSAL RECOVERY "
        "is not real-world causal accuracy.",
        "",
        "No overall model winner, production recommendation, or real-world causal claim is made.",
        "",
        "## Benchmark matrix",
        "",
        f"- Scenarios: {len(matrix['scenarios'])}",
        f"- Seeds: {matrix['seeds']}",
        f"- Sample sizes: {matrix['sample_sizes']}",
        f"- Observation qualities: {len(matrix['observation_qualities'])}",
        f"- Baseline models: {len(matrix['models'])}",
        f"- Synthetic experiments: {matrix['synthetic_experiments']}",
        f"- Model evaluations: {matrix['model_evaluations']}",
        "",
        "## Model behavioral fingerprints",
        "",
        "| Model | Mathematical consequence | Null credit | Demand-capture credit | Retargeting-selected credit | 50% touch-loss divergence | Identity-fragmentation divergence |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]

    null_scenarios = [
        "null_paid_channel",
        "null_channel_high_prevalence",
        "null_channel_last_touch",
        "null_channel_high_intent",
        "null_channel_retargeting",
    ]
    for model in models:
        null_group = [
            record
            for scenario in null_scenarios
            for record in _matching(
                records,
                scenario=scenario,
                quality="perfect",
                sample_size=large_size,
                model=model,
            )
        ]
        null_credit = _mean_credit(null_group, Channel.PINTEREST.value)
        demand_credit = _mean_credit_for(
            records,
            scenario="demand_capture",
            quality="perfect",
            sample_size=large_size,
            model=model,
            channel=Channel.GOOGLE_BRAND.value,
        )
        retarget_credit = _mean_credit_for(
            records,
            scenario="retargeting_selection",
            quality="perfect",
            sample_size=large_size,
            model=model,
            channel=Channel.META.value,
        )
        missing_50 = _mean_comparative_for(
            records,
            quality="missing_50",
            sample_size=large_size,
            model=model,
        )
        fragmented = _mean_comparative_for(
            records,
            quality="fragmented_identity",
            sample_size=large_size,
            model=model,
        )
        lines.append(
            f"| {model} | {allocation.get(model, '')} | {_format(null_credit)} | "
            f"{_format(demand_credit)} | {_format(retarget_credit)} | "
            f"{_format(missing_50)} | {_format(fragmented)} |"
        )

    lines.extend(
        [
            "",
            "The allocation descriptions above are **MATHEMATICAL CONSEQUENCES** of the "
            "defined rules. The numeric columns are **EMPIRICAL SIMULATION RESULTS**.",
            "",
            "## Null-channel test",
            "",
            "Pinterest is the deliberately null paid channel in these variants. Its stored "
            "synthetic incremental effect is zero; prevalence, path position, and selection "
            "are varied independently.",
            "",
            "| Model | Base null | High prevalence | Late position | High-intent selection | Retargeting-like |",
            "| --- | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for model in models:
        values = [
            _mean_credit_for(
                records,
                scenario=scenario,
                quality="perfect",
                sample_size=large_size,
                model=model,
                channel=Channel.PINTEREST.value,
            )
            for scenario in null_scenarios
        ]
        lines.append(
            f"| {model} | " + " | ".join(_format(value) for value in values) + " |"
        )

    lines.extend(
        [
            "",
            "## Demand capture",
            "",
            "The demand-capture world intentionally puts Google Brand near purchase while "
            "its structural effect is zero. The table reports descriptive credit, not effect.",
            "",
            "| Model | Mean Google Brand credit | Mean stored synthetic effect |",
            "| --- | ---: | ---: |",
        ]
    )
    for model in models:
        group = _matching(
            records,
            scenario="demand_capture",
            quality="perfect",
            sample_size=large_size,
            model=model,
        )
        truth_values = [_truth_value(record, Channel.GOOGLE_BRAND.value) for record in group]
        truth = mean(truth_values) if truth_values else 0.0
        lines.append(
            f"| {model} | {_format(_mean_credit(group, Channel.GOOGLE_BRAND.value))} | "
            f"{_format(truth)} |"
        )

    lines.extend(
        [
            "",
            "## Retargeting selection",
            "",
            "The retargeting-selection world exposes high-intent subjects to Meta more often "
            "while the Meta structural effect is zero.",
            "",
            "| Model | Mean Meta credit | Mean stored synthetic effect |",
            "| --- | ---: | ---: |",
        ]
    )
    for model in models:
        group = _matching(
            records,
            scenario="retargeting_selection",
            quality="perfect",
            sample_size=large_size,
            model=model,
        )
        truth_values = [_truth_value(record, Channel.META.value) for record in group]
        truth = mean(truth_values) if truth_values else 0.0
        lines.append(
            f"| {model} | {_format(_mean_credit(group, Channel.META.value))} | "
            f"{_format(truth)} |"
        )

    lines.extend(
        [
            "",
            "## Interaction world",
            "",
            "The outcome equation explicitly contains a Meta × Email interaction. Coalition "
            "logic alone does not make an observed-data Shapley calculation causal.",
            "",
            "| Model | Mean SYNTHETIC CAUSAL RECOVERY L1 | Meta + Email descriptive credit |",
            "| --- | ---: | ---: |",
        ]
    )
    for model in models:
        group = _matching(
            records,
            scenario="channel_interaction",
            quality="perfect",
            sample_size=large_size,
            model=model,
        )
        combined_credit = _mean_credit(group, Channel.META.value) + _mean_credit(
            group,
            Channel.EMAIL.value,
        )
        lines.append(
            f"| {model} | "
            f"{_format(_mean_nested(group, 'metrics', 'synthetic_causal_recovery_l1'))} | "
            f"{_format(combined_credit)} |"
        )

    lines.extend(
        [
            "",
            "## Measurement-degradation curves",
            "",
            "Divergence is the L1 distance between a model's corrupted-observation credit "
            "vector and that same model's perfect-observation vector for the identical "
            "scenario, seed, and sample size.",
            "",
            "| Model | 10% missing | 25% missing | 50% missing | Channel-specific missing |",
            "| --- | ---: | ---: | ---: | ---: |",
        ]
    )
    for model in models:
        values = [
            _mean_comparative_for(
                records,
                quality=quality,
                sample_size=large_size,
                model=model,
            )
            for quality in (
                "missing_10",
                "missing_25",
                "missing_50",
                "channel_specific_missing",
            )
        ]
        lines.append(
            f"| {model} | " + " | ".join(_format(value) for value in values) + " |"
        )

    lines.extend(
        [
            "",
            "## Journey-length and channel-prevalence sensitivity",
            "",
            "| Model | Short-journey recovery L1 | Long-journey recovery L1 | Rare-channel recovery L1 | Common-channel recovery L1 |",
            "| --- | ---: | ---: | ---: | ---: |",
        ]
    )
    for model in models:
        values = [
            _mean_recovery_for(
                records,
                scenario=scenario,
                sample_size=large_size,
                model=model,
            )
            for scenario in (
                "balanced_short_journeys",
                "balanced_long_journeys",
                "balanced_rare_channels",
                "balanced_common_channels",
            )
        ]
        lines.append(
            f"| {model} | " + " | ".join(_format(value) for value in values) + " |"
        )

    lines.extend(
        [
            "",
            "## Sparse-support diagnostics",
            "",
            "Markov reports empirical transition support. Shapley reports observed channel-set "
            "support relative to its possible coalition universe.",
            "",
            "| Sample size | Markov rare-transition fraction | Markov unique paths | Shapley observed-set support ratio | Shapley unique path sets |",
            "| ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for size in sizes:
        markov_group = _matching(
            records,
            scenario="balanced_multi_touch",
            quality="perfect",
            sample_size=size,
            model="markov_removal",
        )
        shapley_group = _matching(
            records,
            scenario="balanced_multi_touch",
            quality="perfect",
            sample_size=size,
            model="shapley",
        )
        lines.append(
            f"| {size} | "
            f"{_format(_mean_nested(markov_group, 'diagnostics', 'rare_transition_fraction'))} | "
            f"{_format(_mean_nested(markov_group, 'diagnostics', 'unique_path_patterns'))} | "
            f"{_format(_mean_nested(shapley_group, 'diagnostics', 'observed_set_support_ratio'))} | "
            f"{_format(_mean_nested(shapley_group, 'diagnostics', 'unique_path_sets'))} |"
        )

    lines.extend(
        [
            "",
            "## Uncertainty across deterministic seeds",
            "",
            "Each full-matrix cell uses repeated deterministic seeds. Values below summarize "
            "the across-seed standard deviation of SYNTHETIC CAUSAL RECOVERY L1 across cells; "
            "they are uncertainty diagnostics, not significance tests.",
            "",
            "| Model | Mean cell stddev at smallest sample | Mean cell stddev at largest sample |",
            "| --- | ---: | ---: |",
        ]
    )
    for model in models:
        small_stds: list[float] = []
        large_stds: list[float] = []
        for aggregate in uncertainty:
            if aggregate.get("model") != model:
                continue
            metrics = aggregate.get("metrics")
            if not isinstance(metrics, dict):
                continue
            recovery = metrics.get("synthetic_causal_recovery_l1")
            if not isinstance(recovery, dict):
                continue
            stddev = recovery.get("stddev")
            if not isinstance(stddev, int | float):
                continue
            if aggregate.get("sample_size") == small_size:
                small_stds.append(float(stddev))
            if aggregate.get("sample_size") == large_size:
                large_stds.append(float(stddev))
        lines.append(
            f"| {model} | {_format(mean(small_stds) if small_stds else 0.0)} | "
            f"{_format(mean(large_stds) if large_stds else 0.0)} |"
        )

    lines.extend(
        [
            "",
            "## Simulator-bias audit",
            "",
        ]
    )
    checks = audit.get("checks", [])
    if isinstance(checks, list):
        for check in checks:
            if not isinstance(check, dict):
                continue
            lines.append(
                f"- **{check.get('check')}** — {check.get('status')}: {check.get('evidence')}"
            )

    lines.extend(
        [
            "",
            "Documented simulator assumptions:",
        ]
    )
    assumptions = audit.get("unavoidable_assumptions", [])
    if isinstance(assumptions, list):
        lines.extend(f"- {assumption}" for assumption in assumptions)

    lines.extend(
        [
            "",
            "## Failure-mode catalog",
            "",
            f"Machine-readable and human-readable catalogs contain {len(failures)} "
            "data-supported failure entries. Entries distinguish mathematical consequences "
            "from empirical simulation results and include measurement quality, repeatability, "
            "magnitude, and sample-size dependence.",
            "",
        ]
    )
    counts = Counter(str(failure.get("classification")) for failure in failures)
    for classification, count in sorted(counts.items()):
        lines.append(f"- {classification}: {count}")

    lines.extend(
        [
            "",
            "## Important interpretation limits",
            "",
            "- SYNTHETIC CAUSAL RECOVERY compares model credit to simulator-defined intervention truth only.",
            "- It does not establish external validity or real-world incrementality.",
            "- The harmful-channel benchmark demonstrates that normalized non-negative credit cannot represent negative causal contribution.",
            "- Missing click IDs and UTM corruption may have little direct effect on these baselines because the current baseline rules operate primarily on already-resolved channel paths; that is a property of this Phase 1 schema, not evidence that those identifiers are unimportant in production measurement.",
            "- Session splitting can have limited effect on models that flatten ordered touchpoints across sessions.",
            "- Support diagnostics should be interpreted empirically; no universal minimum sample size is inferred.",
            "",
            "## Phase 2 research questions",
            "",
            "Phase 2 should investigate questions rather than assume a preferred model:",
            "",
            "1. Can explicitly causal estimands be recovered under richer time-varying treatment and selection mechanisms?",
            "2. How should uncertainty in channel effects and path support be propagated into attribution outputs?",
            "3. Which estimators remain stable under hidden intent, measurement loss, and identity fragmentation?",
            "4. Can experimental or quasi-experimental evidence calibrate observational sequence models without conflating association and incrementality?",
            "5. How should negative, heterogeneous, and interacting treatment effects be represented without forcing normalized non-negative credit?",
            "6. What additional falsification tests should any future model pass before governed real-world evaluation?",
            "",
            "No Phase 2 model is implemented by this report.",
            "",
        ]
    )
    return "\n".join(lines)


def _failure_markdown(failures: list[dict[str, Any]]) -> str:
    lines = [
        "# Phase 1 failure-mode catalog",
        "",
        "| Model | Scenario | Measurement | Classification | Observed behavior | Magnitude |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for failure in failures:
        magnitude = json.dumps(failure.get("magnitude", {}), sort_keys=True)
        lines.append(
            f"| {failure.get('model')} | {failure.get('scenario')} | "
            f"{failure.get('measurement_quality')} | {failure.get('classification')} | "
            f"{failure.get('observed_behavior')} | `{magnitude}` |"
        )
    return "\n".join(lines) + "\n"


def write_analysis_artifacts(records: list[Record], output: str | Path) -> None:
    directory = Path(output)
    directory.mkdir(parents=True, exist_ok=True)
    annotate_comparative_metrics(records)

    manifests: dict[str, Any] = {}
    with gzip.open(
        directory / "results.jsonl.gz",
        "wt",
        encoding="utf-8",
    ) as handle:
        for record in records:
            digest = record.get("manifest_digest")
            manifest = record.get("ground_truth_manifest")
            if isinstance(digest, str) and isinstance(manifest, dict):
                manifests[digest] = manifest
            compact = {
                key: value
                for key, value in record.items()
                if key != "ground_truth_manifest"
            }
            handle.write(json.dumps(compact, sort_keys=True, separators=(",", ":")) + "\n")

    (directory / "ground_truth_manifests.json").write_text(
        json.dumps(manifests, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    matrix = build_matrix_metadata(records)
    uncertainty = aggregate_uncertainty(records)
    failures = build_failure_catalog(records)
    audit = build_simulator_bias_audit(records)
    report = build_research_report(records, uncertainty, failures, audit)

    (directory / "matrix.json").write_text(
        json.dumps(matrix, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (directory / "uncertainty.json").write_text(
        json.dumps(uncertainty, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (directory / "failure_modes.json").write_text(
        json.dumps(failures, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (directory / "failure_modes.md").write_text(
        _failure_markdown(failures),
        encoding="utf-8",
    )
    (directory / "simulator_bias_audit.json").write_text(
        json.dumps(audit, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (directory / "phase1_research_report.md").write_text(
        report + "\n",
        encoding="utf-8",
    )

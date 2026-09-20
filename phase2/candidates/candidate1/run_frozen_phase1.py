from __future__ import annotations

# ruff: noqa: I001

import json
import math
import tempfile
from dataclasses import asdict
from pathlib import Path

from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2.registration import CandidateRegistry
from attribution_lab.phase2_evaluator.isolation import CandidateRunner
from attribution_lab.runner import (
    FULL_SCENARIOS,
    ExperimentSpec,
    _quality_seed,
    corruption_for_quality,
)
from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world
from attribution_lab.stress.corruption import corrupt_world
from candidate_definition import build_declaration, build_development_record
from phase2_candidate_sdk import DeclaredContext, fingerprint_payload

ROOT = Path(__file__).resolve().parent
SEEDS = (7, 17, 29, 41, 73)
PERFECT_SAMPLE_SIZE = 800
SPARSE_SAMPLE_SIZE = 80
ROBUSTNESS_QUALITIES = (
    "perfect",
    "missing_25",
    "missing_50",
    "fragmented_identity",
    "channel_specific_missing",
    "cookie_loss",
    "observation_censoring",
)
FOCAL_ZERO = {
    "demand_capture": Channel.GOOGLE_BRAND.value,
    "retargeting_selection": Channel.META.value,
    "null_paid_channel": Channel.PINTEREST.value,
    "null_channel_high_prevalence": Channel.PINTEREST.value,
    "null_channel_last_touch": Channel.PINTEREST.value,
    "null_channel_high_intent": Channel.PINTEREST.value,
    "null_channel_retargeting": Channel.PINTEREST.value,
}


def _verify_frozen(source: str) -> None:
    manifest = json.loads((ROOT / "freeze_manifest.json").read_text(encoding="utf-8"))
    declaration = build_declaration()
    development = build_development_record()
    with tempfile.TemporaryDirectory(prefix="candidate1-phase1-freeze-") as directory:
        registered = CandidateRegistry(directory).register(
            declaration,
            source,
            development,
            registered_at="2026-09-20T17:45:00+00:00",
        )
    actual = {
        "code_fingerprint": registered.code_fingerprint,
        "declaration_fingerprint": registered.declaration_fingerprint,
        "development_record_fingerprint": registered.development_record_fingerprint,
        "lineage_fingerprint": registered.lineage_fingerprint,
    }
    for key, value in actual.items():
        if manifest[key] != value:
            raise RuntimeError(f"Candidate 1 frozen fingerprint changed: {key}")


def _case(spec: ExperimentSpec):
    config = scenario_config(
        spec.scenario,
        seed=spec.seed,
        n_subjects=spec.sample_size,
    )
    pristine = generate_world(config)
    observed = corrupt_world(
        pristine,
        corruption_for_quality(spec.observation_quality),
        seed=_quality_seed(spec),
    )
    truth = {
        channel.value: value
        for channel, value in pristine.manifest.incremental_effect_map().items()
    }
    return to_observable_dataset(observed.dataset), truth


def _run(source: str, spec: ExperimentSpec) -> dict[str, object]:
    declaration = build_declaration()
    dataset, truth = _case(spec)
    response = CandidateRunner().execute(
        source,
        dataset,
        DeclaredContext(
            stage="FROZEN_PHASE1",
            scenario_family=(
                f"{spec.scenario}:{spec.observation_quality}:n{spec.sample_size}"
            ),
            estimand_fingerprint=fingerprint_payload(asdict(declaration.estimand)),
            phase1_reference="1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf",
        ),
    )
    estimates = dict(response.estimates)
    common = sorted(set(estimates) & set(truth))
    errors = [abs(estimates[key] - truth[key]) for key in common]
    lower = dict(response.uncertainty.lower) if response.uncertainty else {}
    upper = dict(response.uncertainty.upper) if response.uncertainty else {}
    interval_coverage = (
        sum(int(lower[key] <= truth[key] <= upper[key]) for key in common) / len(common)
        if common and response.uncertainty
        else 0.0
    )
    finite = all(math.isfinite(value) for value in estimates.values())
    if response.uncertainty is not None:
        finite = finite and all(
            math.isfinite(value)
            for value in (*lower.values(), *upper.values())
        )
    return {
        "spec": asdict(spec),
        "estimates": estimates,
        "truth": truth,
        "mean_absolute_error": (
            sum(errors) / len(errors) if errors else float("inf")
        ),
        "max_absolute_error": max(errors) if errors else float("inf"),
        "coverage_fraction": len(common) / len(truth),
        "interval_coverage_fraction": interval_coverage,
        "finite": finite,
    }


def _vector_l1(left: dict[str, float], right: dict[str, float]) -> float:
    channels = sorted(set(left) | set(right))
    return sum(abs(left.get(channel, 0.0) - right.get(channel, 0.0)) for channel in channels)


def main() -> None:
    source = (ROOT / "model.py").read_text(encoding="utf-8")
    _verify_frozen(source)

    perfect_results = [
        _run(
            source,
            ExperimentSpec(scenario, seed, PERFECT_SAMPLE_SIZE, "perfect"),
        )
        for scenario in FULL_SCENARIOS
        for seed in SEEDS
    ]
    sparse_results = [
        _run(
            source,
            ExperimentSpec(scenario, seed, SPARSE_SAMPLE_SIZE, "perfect"),
        )
        for scenario in FULL_SCENARIOS
        for seed in SEEDS
    ]

    robustness: dict[tuple[int, str], dict[str, object]] = {}
    for seed in SEEDS:
        for quality in ROBUSTNESS_QUALITIES:
            result = _run(
                source,
                ExperimentSpec(
                    "balanced_multi_touch",
                    seed,
                    PERFECT_SAMPLE_SIZE,
                    quality,
                ),
            )
            robustness[(seed, quality)] = result

    perfect_mean_mae = sum(
        float(result["mean_absolute_error"]) for result in perfect_results
    ) / len(perfect_results)
    perfect_interval_coverage = sum(
        float(result["interval_coverage_fraction"]) for result in perfect_results
    ) / len(perfect_results)

    focal_zero: dict[str, dict[str, object]] = {}
    for scenario, channel in FOCAL_ZERO.items():
        values = [
            abs(float(result["estimates"].get(channel, 0.0)))
            for result in perfect_results
            if result["spec"]["scenario"] == scenario
        ]
        focal_zero[scenario] = {
            "channel": channel,
            "mean_absolute_estimate": sum(values) / len(values),
            "max_absolute_estimate": max(values),
            "pass": (sum(values) / len(values)) <= 0.05,
        }

    harmful_values = [
        float(result["estimates"].get(Channel.PINTEREST.value, 0.0))
        for result in perfect_results
        if result["spec"]["scenario"] == "harmful_channel"
    ]
    harmful_pass = bool(harmful_values) and all(value < 0.0 for value in harmful_values)

    divergence: dict[str, list[float]] = {"missing_25": [], "missing_50": []}
    for seed in SEEDS:
        perfect_estimates = robustness[(seed, "perfect")]["estimates"]
        for quality in divergence:
            degraded = robustness[(seed, quality)]["estimates"]
            divergence[quality].append(
                _vector_l1(perfect_estimates, degraded)
            )
    mean_divergence = {
        quality: sum(values) / len(values)
        for quality, values in divergence.items()
    }

    sparse_finite = all(bool(result["finite"]) for result in sparse_results)
    perfect_coverage_complete = all(
        float(result["coverage_fraction"]) == 1.0
        for result in perfect_results
    )

    criteria = {
        "perfect_observation_mean_effect_mae": {
            "value": perfect_mean_mae,
            "threshold": 0.08,
            "pass": perfect_mean_mae <= 0.08,
        },
        "known_zero_effects": {
            "details": focal_zero,
            "pass": all(bool(value["pass"]) for value in focal_zero.values()),
        },
        "harmful_channel_negative_sign": {
            "values": harmful_values,
            "pass": harmful_pass,
        },
        "balanced_missing_25_l1_from_perfect": {
            "value": mean_divergence["missing_25"],
            "threshold": 0.10,
            "pass": mean_divergence["missing_25"] <= 0.10,
        },
        "balanced_missing_50_l1_from_perfect": {
            "value": mean_divergence["missing_50"],
            "threshold": 0.18,
            "pass": mean_divergence["missing_50"] <= 0.18,
        },
        "small_sample_finite_outputs": {
            "pass": sparse_finite,
        },
        "mean_interval_coverage_fraction": {
            "value": perfect_interval_coverage,
            "threshold": 0.75,
            "pass": perfect_interval_coverage >= 0.75,
        },
        "complete_channel_coverage": {
            "pass": perfect_coverage_complete,
        },
    }
    overall = all(bool(value["pass"]) for value in criteria.values())

    focus = {
        scenario: [
            {
                "seed": int(result["spec"]["seed"]),
                "estimate": float(result["estimates"].get(channel, 0.0)),
                "truth": float(result["truth"].get(channel, 0.0)),
            }
            for result in perfect_results
            if result["spec"]["scenario"] == scenario
        ]
        for scenario, channel in FOCAL_ZERO.items()
    }
    payload = {
        "stage": "FROZEN_PHASE1",
        "phase1_reference": "1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf",
        "candidate_id": build_declaration().candidate_id,
        "candidate_version": build_declaration().version,
        "cases_evaluated": len(perfect_results) + len(sparse_results) + len(robustness),
        "perfect_cases": len(perfect_results),
        "sparse_cases": len(sparse_results),
        "robustness_cases": len(robustness),
        "criteria": criteria,
        "focus_zero_effect_estimates": focus,
        "robustness_summary": {
            "mean_l1_divergence_from_perfect": mean_divergence,
            "qualities": list(ROBUSTNESS_QUALITIES),
        },
        "overall_preregistered_phase1_pass": overall,
    }
    print("CANDIDATE1_PHASE1_RESULT=" + json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()

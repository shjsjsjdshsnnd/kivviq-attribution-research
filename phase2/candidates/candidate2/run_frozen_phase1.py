from __future__ import annotations

# ruff: noqa: I001

import json
import math
import tempfile
from dataclasses import asdict
from pathlib import Path

from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2.registration import CandidateRegistry
from attribution_lab.phase2_evaluator.isolation import (
    CandidateExecutionError,
    CandidateRunner,
)
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
from phase2_candidate_sdk import DeclaredContext, fingerprint_payload

from candidate_definition import build_declaration, build_development_record

ROOT = Path(__file__).resolve().parent
SEEDS = (7, 17, 29, 41, 73)
PERFECT_SAMPLE_SIZE = 800
SPARSE_SAMPLE_SIZE = 80
ROBUSTNESS_QUALITIES = ("perfect", "missing_50", "fragmented_identity")
FOCAL_ZERO = {
    "demand_capture": Channel.GOOGLE_BRAND.value,
    "retargeting_selection": Channel.META.value,
    "null_paid_channel": Channel.PINTEREST.value,
    "null_channel_high_prevalence": Channel.PINTEREST.value,
    "null_channel_last_touch": Channel.PINTEREST.value,
    "null_channel_high_intent": Channel.PINTEREST.value,
    "null_channel_retargeting": Channel.PINTEREST.value,
}
PRIMARY_SELECTION = (
    "demand_capture",
    "retargeting_selection",
    "null_channel_high_intent",
    "null_channel_retargeting",
)


def _verify_frozen(source: str) -> None:
    manifest = json.loads((ROOT / "FROZEN.json").read_text(encoding="utf-8"))
    declaration = build_declaration()
    development = build_development_record()
    with tempfile.TemporaryDirectory(prefix="candidate2-phase1-freeze-") as directory:
        registered = CandidateRegistry(directory).register(
            declaration,
            source,
            development,
            registered_at="2026-09-20T22:23:00+00:00",
        )
    actual = {
        "code_fingerprint": registered.code_fingerprint,
        "declaration_fingerprint": registered.declaration_fingerprint,
        "development_record_fingerprint": registered.development_record_fingerprint,
        "lineage_fingerprint": registered.lineage_fingerprint,
    }
    for key, value in actual.items():
        if manifest[key] != value:
            raise RuntimeError(f"Candidate 2 frozen fingerprint changed: {key}")


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
    dataset, truth = _case(spec)
    declaration = build_declaration()
    try:
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
    except (CandidateExecutionError, ValueError):
        return {
            "spec": asdict(spec),
            "estimates": {},
            "truth": truth,
            "mean_absolute_error": float("inf"),
            "max_absolute_error": float("inf"),
            "coverage_fraction": 0.0,
            "interval_coverage_fraction": 0.0,
            "finite": False,
            "overlap": {},
            "minimum_arm_ess": 0.0,
            "maximum_extreme_propensity_fraction": 1.0,
            "maximum_inverse_weight": float("inf"),
        }

    estimates = dict(response.estimates)
    common = sorted(set(estimates) & set(truth))
    errors = [abs(estimates[key] - truth[key]) for key in common]
    lower = dict(response.uncertainty.lower) if response.uncertainty else {}
    upper = dict(response.uncertainty.upper) if response.uncertainty else {}
    coverage = len(common) / len(truth) if truth else 0.0
    interval_coverage = (
        sum(int(lower[key] <= truth[key] <= upper[key]) for key in common) / len(common)
        if common and response.uncertainty
        else 0.0
    )
    finite = all(math.isfinite(value) for value in estimates.values())
    if response.uncertainty is not None:
        finite = finite and all(
            math.isfinite(value) for value in (*lower.values(), *upper.values())
        )

    diagnostics = dict(response.diagnostics)
    overlap = json.loads(diagnostics.get("overlap_json", "{}"))
    minimum_arm_ess = min(
        (
            min(float(values["treated_ess"]), float(values["control_ess"]))
            for values in overlap.values()
        ),
        default=0.0,
    )
    maximum_extreme = max(
        (
            float(values["extreme_raw_propensity_fraction"])
            for values in overlap.values()
        ),
        default=1.0,
    )
    maximum_weight = max(
        (float(values["maximum_inverse_weight"]) for values in overlap.values()),
        default=float("inf"),
    )
    converged = all(
        float(values.get("outcome_converged", 0.0)) == 1.0
        and float(values.get("propensity_converged", 0.0)) == 1.0
        for values in overlap.values()
    )
    finite = finite and converged

    return {
        "spec": asdict(spec),
        "estimates": estimates,
        "truth": truth,
        "mean_absolute_error": (
            sum(errors) / len(errors) if errors else float("inf")
        ),
        "max_absolute_error": max(errors) if errors else float("inf"),
        "coverage_fraction": coverage,
        "interval_coverage_fraction": interval_coverage,
        "finite": finite,
        "overlap": overlap,
        "minimum_arm_ess": minimum_arm_ess,
        "maximum_extreme_propensity_fraction": maximum_extreme,
        "maximum_inverse_weight": maximum_weight,
    }


def _mean_vector_change(left: dict[str, float], right: dict[str, float]) -> float:
    if set(left) != set(right) or not left:
        return float("inf")
    channels = sorted(left)
    return sum(
        abs(left[channel] - right[channel]) for channel in channels
    ) / len(channels)


def main() -> None:
    source = (ROOT / "model.py").read_text(encoding="utf-8")
    _verify_frozen(source)

    perfect_results = [
        _run(source, ExperimentSpec(scenario, seed, PERFECT_SAMPLE_SIZE, "perfect"))
        for scenario in FULL_SCENARIOS
        for seed in SEEDS
    ]
    sparse_results = [
        _run(source, ExperimentSpec(scenario, seed, SPARSE_SAMPLE_SIZE, "perfect"))
        for scenario in FULL_SCENARIOS
        for seed in SEEDS
    ]

    robustness: dict[tuple[int, str], dict[str, object]] = {}
    for seed in SEEDS:
        for quality in ROBUSTNESS_QUALITIES:
            robustness[(seed, quality)] = _run(
                source,
                ExperimentSpec(
                    "balanced_multi_touch",
                    seed,
                    PERFECT_SAMPLE_SIZE,
                    quality,
                ),
            )

    comparator = json.loads(
        (ROOT / "candidate1_frozen_phase1_comparator.json").read_text(
            encoding="utf-8"
        )
    )
    candidate1_means = {
        scenario: float(values["value"])
        for scenario, values in comparator[
            "selection_known_zero_scenario_mean_absolute_estimates"
        ].items()
    }

    zero_means: dict[str, float] = {}
    for scenario, channel in FOCAL_ZERO.items():
        values = [
            abs(float(result["estimates"].get(channel, float("inf"))))
            for result in perfect_results
            if result["spec"]["scenario"] == scenario
        ]
        zero_means[scenario] = sum(values) / len(values)

    c2_selection_means = {
        scenario: zero_means[scenario] for scenario in PRIMARY_SELECTION
    }
    c2_selection_aggregate = sum(c2_selection_means.values()) / len(
        PRIMARY_SELECTION
    )
    c1_selection_aggregate = sum(candidate1_means.values()) / len(
        PRIMARY_SELECTION
    )
    improved_scenarios = sum(
        int(c2_selection_means[scenario] < candidate1_means[scenario])
        for scenario in PRIMARY_SELECTION
    )
    comparative_pass = (
        c2_selection_aggregate < c1_selection_aggregate
        and improved_scenarios >= 3
    )

    all_zero_aggregate = sum(zero_means.values()) / len(zero_means)
    perfect_mean_mae = sum(
        float(result["mean_absolute_error"]) for result in perfect_results
    ) / len(perfect_results)
    perfect_interval_coverage = sum(
        float(result["interval_coverage_fraction"]) for result in perfect_results
    ) / len(perfect_results)

    harmful = [
        result
        for result in perfect_results
        if result["spec"]["scenario"] == "harmful_channel"
    ]
    harmful_estimates = [
        float(result["estimates"].get(Channel.PINTEREST.value, float("inf")))
        for result in harmful
    ]
    harmful_errors = [
        abs(
            float(result["estimates"].get(Channel.PINTEREST.value, float("inf")))
            - float(result["truth"].get(Channel.PINTEREST.value, 0.0))
        )
        for result in harmful
    ]
    harmful_mean_estimate = sum(harmful_estimates) / len(harmful_estimates)
    harmful_mean_error = sum(harmful_errors) / len(harmful_errors)

    degradation: dict[str, list[float]] = {
        "missing_50": [],
        "fragmented_identity": [],
    }
    for seed in SEEDS:
        perfect = robustness[(seed, "perfect")]["estimates"]
        for quality in degradation:
            degraded = robustness[(seed, quality)]["estimates"]
            degradation[quality].append(_mean_vector_change(perfect, degraded))
    mean_degradation = {
        quality: sum(values) / len(values)
        for quality, values in degradation.items()
    }

    small_sample_finite = all(bool(result["finite"]) for result in sparse_results)
    numerical_valid = all(bool(result["finite"]) for result in perfect_results)
    perfect_complete_coverage = all(
        float(result["coverage_fraction"]) == 1.0 for result in perfect_results
    )

    criteria = {
        "observed_selection_comparison_vs_candidate1": {
            "candidate2_scenario_mean_absolute_estimates": c2_selection_means,
            "candidate1_scenario_mean_absolute_estimates": candidate1_means,
            "candidate2_aggregate": c2_selection_aggregate,
            "candidate1_aggregate": c1_selection_aggregate,
            "scenario_means_improved": improved_scenarios,
            "required_improved_scenarios": 3,
            "pass": comparative_pass,
        },
        "known_zero_aggregate": {
            "scenario_means": zero_means,
            "value": all_zero_aggregate,
            "threshold": 0.06,
            "pass": all_zero_aggregate <= 0.06,
        },
        "harmful_effect": {
            "mean_estimate": harmful_mean_estimate,
            "mean_absolute_error": harmful_mean_error,
            "error_threshold": 0.07,
            "pass": harmful_mean_estimate < 0.0 and harmful_mean_error <= 0.07,
        },
        "overall_perfect_observation_mean_effect_mae": {
            "value": perfect_mean_mae,
            "threshold": 0.05,
            "pass": perfect_mean_mae <= 0.05,
        },
        "mean_interval_coverage_fraction": {
            "value": perfect_interval_coverage,
            "threshold": 0.80,
            "pass": perfect_interval_coverage >= 0.80,
        },
        "missing_50_mean_absolute_effect_vector_change": {
            "value": mean_degradation["missing_50"],
            "threshold": 0.15,
            "pass": mean_degradation["missing_50"] <= 0.15,
        },
        "fragmented_identity_mean_absolute_effect_vector_change": {
            "value": mean_degradation["fragmented_identity"],
            "threshold": 0.15,
            "pass": mean_degradation["fragmented_identity"] <= 0.15,
        },
        "small_sample_finite_outputs": {"pass": small_sample_finite},
        "perfect_complete_channel_coverage": {"pass": perfect_complete_coverage},
        "numerical_validity": {"pass": numerical_valid},
    }
    overall = all(bool(item["pass"]) for item in criteria.values())

    overlap_summary = {
        "minimum_arm_ess_across_perfect_cases": min(
            float(result["minimum_arm_ess"]) for result in perfect_results
        ),
        "maximum_extreme_propensity_fraction_across_perfect_cases": max(
            float(result["maximum_extreme_propensity_fraction"])
            for result in perfect_results
        ),
        "maximum_inverse_weight_across_perfect_cases": max(
            float(result["maximum_inverse_weight"]) for result in perfect_results
        ),
    }

    payload = {
        "stage": "FROZEN_PHASE1",
        "candidate_id": build_declaration().candidate_id,
        "candidate_version": build_declaration().version,
        "phase1_reference": "1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf",
        "candidate1_comparator_reference": {
            "candidate_id": comparator["candidate_id"],
            "candidate_version": comparator["candidate_version"],
            "source_pr": comparator["source_pr"],
            "source_file": comparator["source_file"],
            "candidate1_holdout_used": False,
        },
        "cases_evaluated": len(perfect_results)
        + len(sparse_results)
        + len(robustness),
        "criteria": criteria,
        "overlap_summary": overlap_summary,
        "preholdout_eligible": overall,
        "overall_preregistered_phase1_pass": overall,
        "candidate2_holdout_exposure_consumed": False,
        "candidate1_holdout_metrics_used_for_tuning": False,
    }
    (ROOT / "frozen_phase1_results.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    lines = [
        "# Candidate 2 frozen Phase 1 evaluation",
        "",
        f"- Candidate: {payload['candidate_id']} v{payload['candidate_version']}",
        f"- Pre-holdout eligible: **{overall}**",
        "- Candidate 2 sealed holdout exposure consumed: **False**",
        "- Candidate 1 sealed holdout used: **False**",
        "",
        "## Preregistered criteria",
        "",
    ]
    for name, result in criteria.items():
        lines.append(f"- {name}: **{'PASS' if result['pass'] else 'FAIL'}**")
    lines.extend(
        [
            "",
            "## Propensity / overlap diagnostics",
            "",
            (
                "- Minimum treated/control ESS across perfect cases: "
                f"{overlap_summary['minimum_arm_ess_across_perfect_cases']:.3f}"
            ),
            (
                "- Maximum extreme raw propensity fraction: "
                f"{overlap_summary['maximum_extreme_propensity_fraction_across_perfect_cases']:.3f}"
            ),
            (
                "- Maximum inverse weight: "
                f"{overlap_summary['maximum_inverse_weight_across_perfect_cases']:.3f}"
            ),
            "",
            "Candidate 1 is used only as a frozen Phase 1 historical comparator. "
            "No Candidate 1 holdout metric or result was used.",
            "",
        ]
    )
    (ROOT / "frozen_phase1_report.md").write_text(
        "\n".join(lines).rstrip() + "\n",
        encoding="utf-8",
    )
    print("CANDIDATE2_PHASE1_RESULT=" + json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()

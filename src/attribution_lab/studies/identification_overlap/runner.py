from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Any

from attribution_lab.schemas.core import Channel
from attribution_lab.stress.corruption import corrupt_world
from attribution_lab.studies.identification_overlap.diagnostics import diagnose
from attribution_lab.studies.identification_overlap.features import prepare_diagnostic_data
from attribution_lab.studies.identification_overlap.matrix import (
    FOCAL_CHANNEL,
    LARGE_REFERENCE_SIZE,
    MEASUREMENT_QUALITIES,
    StructuralCell,
    large_reference_config,
    measurement_corruption,
    structural_cells,
    study_cells,
    world_config,
)
from attribution_lab.studies.identification_overlap.taxonomy import classify
from attribution_lab.studies.identification_overlap.trace import generate_instrumented_world


def _structural_key(cell: StructuralCell) -> str:
    return (
        f"s={cell.selection_strength:g}|"
        f"p={cell.focal_prevalence_anchor:g}|"
        f"l={cell.latent_intent_weight:g}"
    )


def _run_one(
    structural: StructuralCell,
    *,
    sample_size: int,
    quality: str,
    seed: int,
) -> dict[str, Any]:
    config = world_config(structural, sample_size=sample_size, seed=seed)
    instrumented = generate_instrumented_world(config, focal_channel=FOCAL_CHANNEL)
    observed = corrupt_world(
        instrumented.world,
        measurement_corruption(quality),
        seed=seed + 70_000 + MEASUREMENT_QUALITIES.index(quality) * 1_009,
    )
    data = prepare_diagnostic_data(
        observed.dataset,
        instrumented.oracle_subjects,
        focal_channel=FOCAL_CHANNEL,
    )
    truth = float(
        instrumented.world.manifest.incremental_effect_map().get(Channel.META, 0.0)
    )
    diagnostics = diagnose(
        data,
        truth=truth,
        selection_strength=structural.selection_strength,
        latent_intent_weight=structural.latent_intent_weight,
    )
    return {
        "structural": asdict(structural),
        "sample_size": sample_size,
        "measurement_quality": quality,
        "seed": seed,
        "n_observed_rows": len(data.subject_ids),
        "truth": diagnostics.truth,
        "observable": asdict(diagnostics.observable),
        "oracle": asdict(diagnostics.oracle),
        "null_propensity_log_loss": diagnostics.null_propensity_log_loss,
        "observable_predictability_gain": diagnostics.observable_predictability_gain,
        "oracle_predictability_gain": diagnostics.oracle_predictability_gain,
        "information_log_loss_gap": diagnostics.information_log_loss_gap,
        "structural_unobserved_common_cause": diagnostics.structural_unobserved_common_cause,
    }


def _mean(records: list[dict[str, Any]], path: tuple[str, ...]) -> float:
    values: list[float] = []
    for record in records:
        current: Any = record
        for key in path:
            current = current[key]
        values.append(float(current))
    return sum(values) / len(values)


def run_study(*, quick: bool = False) -> dict[str, Any]:
    structural = structural_cells()
    if quick:
        structural = structural[:3]
        cells = tuple(
            cell
            for cell in study_cells()
            if cell.structural in structural
            and cell.sample_size in (80, 800)
            and cell.measurement_quality in ("perfect", "missing_25")
            and cell.seed == 17
        )
    else:
        cells = study_cells()

    large_reference: dict[str, dict[str, Any]] = {}
    for structural_cell in structural:
        config = large_reference_config(structural_cell)
        instrumented = generate_instrumented_world(config, focal_channel=FOCAL_CHANNEL)
        data = prepare_diagnostic_data(
            instrumented.world.dataset,
            instrumented.oracle_subjects,
            focal_channel=FOCAL_CHANNEL,
        )
        truth = float(
            instrumented.world.manifest.incremental_effect_map().get(Channel.META, 0.0)
        )
        result = diagnose(
            data,
            truth=truth,
            selection_strength=structural_cell.selection_strength,
            latent_intent_weight=structural_cell.latent_intent_weight,
        )
        large_reference[_structural_key(structural_cell)] = {
            "n": LARGE_REFERENCE_SIZE,
            "truth": truth,
            "observable": asdict(result.observable),
            "oracle": asdict(result.oracle),
            "observable_predictability_gain": result.observable_predictability_gain,
            "oracle_predictability_gain": result.oracle_predictability_gain,
            "information_log_loss_gap": result.information_log_loss_gap,
            "structural_unobserved_common_cause": result.structural_unobserved_common_cause,
        }

    raw = [
        _run_one(
            cell.structural,
            sample_size=cell.sample_size,
            quality=cell.measurement_quality,
            seed=cell.seed,
        )
        for cell in cells
    ]

    groups: dict[tuple[str, int, str], list[dict[str, Any]]] = defaultdict(list)
    for record in raw:
        structural_cell = StructuralCell(**record["structural"])
        groups[
            (
                _structural_key(structural_cell),
                int(record["sample_size"]),
                str(record["measurement_quality"]),
            )
        ].append(record)

    aggregates: list[dict[str, Any]] = []
    perfect_lookup: dict[tuple[str, int], float] = {}
    for (key, sample_size, quality), records in groups.items():
        observable_error = _mean(records, ("observable", "absolute_error"))
        if quality == "perfect":
            perfect_lookup[(key, sample_size)] = observable_error

    for (key, sample_size, quality), records in sorted(groups.items()):
        structural_payload = records[0]["structural"]
        reference = large_reference[key]
        observable_error = _mean(records, ("observable", "absolute_error"))
        oracle_error = _mean(records, ("oracle", "absolute_error"))
        oracle_extreme = _mean(records, ("oracle", "extreme_propensity_fraction"))
        oracle_min_ess = min(
            _mean(records, ("oracle", "treated_ess")),
            _mean(records, ("oracle", "control_ess")),
        )
        mean_rows = _mean(records, ("n_observed_rows",))
        taxonomy = classify(
            measurement_quality=quality,
            sample_size=sample_size,
            observable_error=observable_error,
            oracle_error=oracle_error,
            perfect_same_sample_error=perfect_lookup.get(
                (key, sample_size),
                observable_error,
            ),
            large_observable_error=float(reference["observable"]["absolute_error"]),
            large_oracle_error=float(reference["oracle"]["absolute_error"]),
            oracle_extreme_fraction=oracle_extreme,
            oracle_min_ess_fraction=oracle_min_ess / max(mean_rows, 1.0),
            observable_predictability_gain=_mean(
                records,
                ("observable_predictability_gain",),
            ),
            oracle_predictability_gain=_mean(
                records,
                ("oracle_predictability_gain",),
            ),
            information_logloss_gap=_mean(
                records,
                ("information_log_loss_gap",),
            ),
            structural_unobserved_common_cause=bool(
                records[0]["structural_unobserved_common_cause"]
            ),
        )
        aggregates.append(
            {
                "structural": structural_payload,
                "sample_size": sample_size,
                "measurement_quality": quality,
                "seeds": [int(record["seed"]) for record in records],
                "mean_observed_rows": mean_rows,
                "truth": _mean(records, ("truth",)),
                "observable_effect_error": observable_error,
                "oracle_effect_error": oracle_error,
                "observable_interval_coverage": _mean(
                    records,
                    ("observable", "interval_lower"),
                )
                <= _mean(records, ("truth",))
                <= _mean(records, ("observable", "interval_upper")),
                "observable_propensity_auc": _mean(
                    records,
                    ("observable", "propensity_auc"),
                ),
                "oracle_propensity_auc": _mean(
                    records,
                    ("oracle", "propensity_auc"),
                ),
                "observable_predictability_gain": _mean(
                    records,
                    ("observable_predictability_gain",),
                ),
                "oracle_predictability_gain": _mean(
                    records,
                    ("oracle_predictability_gain",),
                ),
                "information_log_loss_gap": _mean(
                    records,
                    ("information_log_loss_gap",),
                ),
                "oracle_extreme_propensity_fraction": oracle_extreme,
                "observable_extreme_propensity_fraction": _mean(
                    records,
                    ("observable", "extreme_propensity_fraction"),
                ),
                "oracle_treated_ess": _mean(records, ("oracle", "treated_ess")),
                "oracle_control_ess": _mean(records, ("oracle", "control_ess")),
                "observable_treated_ess": _mean(
                    records,
                    ("observable", "treated_ess"),
                ),
                "observable_control_ess": _mean(
                    records,
                    ("observable", "control_ess"),
                ),
                "observable_max_abs_smd_unweighted": _mean(
                    records,
                    ("observable", "max_abs_smd_unweighted"),
                ),
                "observable_max_abs_smd_weighted": _mean(
                    records,
                    ("observable", "max_abs_smd_weighted"),
                ),
                "large_sample_observable_error": float(
                    reference["observable"]["absolute_error"]
                ),
                "large_sample_oracle_error": float(
                    reference["oracle"]["absolute_error"]
                ),
                "structural_unobserved_common_cause": bool(
                    records[0]["structural_unobserved_common_cause"]
                ),
                "primary_limitation": taxonomy.primary_limitation,
                "diagnostic_flags": list(taxonomy.flags),
                "taxonomy_explanation": taxonomy.explanation,
            }
        )

    counts = Counter(item["primary_limitation"] for item in aggregates)
    return {
        "study": "identification-overlap-recoverability-v1",
        "candidate_independent": True,
        "candidate3_implemented": False,
        "oracle_diagnostic_only": True,
        "oracle_features_exported_to_candidate_interfaces": False,
        "axes": {
            "selection_strength": sorted(
                {cell.selection_strength for cell in structural}
            ),
            "focal_prevalence_anchor": sorted(
                {cell.focal_prevalence_anchor for cell in structural}
            ),
            "latent_intent_weight": sorted(
                {cell.latent_intent_weight for cell in structural}
            ),
            "sample_size": sorted({int(item["sample_size"]) for item in aggregates}),
            "measurement_quality": sorted(
                {str(item["measurement_quality"]) for item in aggregates}
            ),
        },
        "large_reference": large_reference,
        "recoverability_map": aggregates,
        "taxonomy_counts": dict(sorted(counts.items())),
        "raw_run_count": len(raw),
        "aggregate_cell_count": len(aggregates),
    }


def write_study(payload: dict[str, Any], output: str | Path) -> None:
    destination = Path(output)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "recoverability_map.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    lines = [
        "# Identification & Overlap Study",
        "",
        "Candidate-independent diagnostic study. No Candidate 3 estimator is implemented.",
        "",
        "## Taxonomy",
        "",
    ]
    for name, count in payload["taxonomy_counts"].items():
        lines.append(f"- {name}: **{count}** cells")
    lines.extend(
        [
            "",
            "## Oracle boundary",
            "",
            "Latent intent and true propensities are used only inside the study diagnostic. "
            "They are never exported as candidate features or proxies.",
            "",
            "## Recoverability map dimensions",
            "",
            "- selection strength",
            "- focal treatment prevalence / overlap anchor",
            "- latent confounding strength",
            "- sample size",
            "- measurement quality",
            "",
            "## Interpretation boundary",
            "",
            "The taxonomy separates estimator/specification, positivity/support, observable-information, "
            "finite-sample, measurement and structural-identification limitations. A primary label does not "
            "erase secondary diagnostic flags.",
            "",
        ]
    )
    (destination / "study_report.md").write_text(
        "\n".join(lines),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--output", default="study_output/identification_overlap")
    args = parser.parse_args()
    payload = run_study(quick=args.quick)
    write_study(payload, args.output)
    print(
        "IDENTIFICATION_OVERLAP_STUDY="
        + json.dumps(
            {
                "raw_run_count": payload["raw_run_count"],
                "aggregate_cell_count": payload["aggregate_cell_count"],
                "taxonomy_counts": payload["taxonomy_counts"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

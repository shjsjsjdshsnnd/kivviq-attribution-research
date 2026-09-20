from __future__ import annotations

import argparse
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2_evaluator.evaluator import evaluate_known_case
from attribution_lab.phase2_evaluator.results import EvaluationStage
from attribution_lab.simulation.config import WorldConfig, scenario_config
from attribution_lab.simulation.generator import generate_world
from attribution_lab.stress.corruption import CorruptionConfig, corrupt_world
from phase2_candidate_sdk import (
    CandidateDeclaration,
    EstimandDefinition,
    EstimandKind,
    FamilyCriterion,
    FalsificationCriteria,
)

CANDIDATE_ID = "candidate1-stratified-lpm"
CANDIDATE_VERSION = "1.0.0"


def development_declaration() -> CandidateDeclaration:
    # Development-only placeholder machine rules are deliberately permissive.
    # Final preregistered falsification criteria replace these before candidate freeze.
    criteria = FalsificationCriteria(
        primary_success_criteria=("development diagnostics only",),
        failure_criteria=("non-finite output",),
        uncertainty_requirements=("finite interval for every estimate",),
        robustness_requirements=("development worlds execute deterministically",),
        required_holdout_families=("selection_shift",),
        family_rules=(
            FamilyCriterion(
                family="selection_shift",
                metric="mean_absolute_error",
                operator="lte",
                threshold=1.0,
            ),
        ),
        known_unsupported_cases=(
            "strong unmeasured confounding",
            "strong interactions",
            "strong treatment heterogeneity",
        ),
    )
    return CandidateDeclaration(
        candidate_id=CANDIDATE_ID,
        version=CANDIDATE_VERSION,
        estimand=EstimandDefinition(
            kind=EstimandKind.INCREMENTAL_CONVERSION_PROBABILITY,
            population="synthetic subjects entering a 21-day observation window",
            treatment_or_exposure="observed target-channel exposure",
            outcome="qualifying conversion within 21 days",
            horizon_hours=24.0 * 21.0,
            intervention="set target-channel exposure present",
            comparison="set target-channel exposure absent",
            unit_of_analysis="synthetic subject",
            temporal_ordering="eligible exposure precedes qualifying conversion",
            treatment_regime="single-channel binary intervention",
            aggregation_target="population-average channel risk difference",
        ),
        hypothesis=(
            "Observable cross-channel exposure patterns can proxy part of selection and "
            "make adjusted linear risk differences closer to synthetic intervention truth."
        ),
        required_observable_inputs=(
            "channel presence indicators",
            "conversion outcome",
            "identity confidence",
            "censoring status",
            "observation-window duration",
        ),
        assumptions=(
            "approximate conditional exchangeability after observed adjustment",
            "sufficient positivity",
            "no interference",
            "additive linear conditional mean is adequate for the marginal target",
        ),
        supported_outcome_type="binary",
        negative_effects_representable=True,
        interactions_representable=False,
        uncertainty_method="HC1 robust 95% interval",
        hyperparameters=(("ridge_lambda", "0.0001"),),
        hyperparameter_selection_procedure=(
            "fixed for numerical stabilization; no holdout-based selection"
        ),
        development_world_usage=(
            "dev-balanced",
            "dev-selection-null",
            "dev-negative",
            "dev-interaction",
            "dev-missing25",
        ),
        randomization_behavior="deterministic estimator; simulator seeds fixed by development plan",
        expected_failure_conditions=(
            "unmeasured latent intent not proxied by observed co-exposures",
            "strong interactions or heterogeneity",
            "positivity failure",
            "severe measurement corruption",
            "time-varying effects",
        ),
        falsification_criteria=criteria,
    )


def _worlds() -> list[tuple[str, WorldConfig, CorruptionConfig | None]]:
    balanced = scenario_config("balanced_multi_touch", seed=1101, n_subjects=600)
    selection = replace(
        scenario_config("retargeting_selection", seed=1102, n_subjects=600),
        scenario_name="candidate1-dev-selection-null",
    )
    negative = replace(
        scenario_config("harmful_channel", seed=1103, n_subjects=600),
        scenario_name="candidate1-dev-negative",
    )
    interaction = replace(
        scenario_config("channel_interaction", seed=1104, n_subjects=600),
        scenario_name="candidate1-dev-interaction",
    )
    missing = replace(
        scenario_config("balanced_multi_touch", seed=1105, n_subjects=600),
        scenario_name="candidate1-dev-missing25",
    )
    return [
        ("dev-balanced", balanced, None),
        ("dev-selection-null", selection, None),
        ("dev-negative", negative, None),
        ("dev-interaction", interaction, None),
        (
            "dev-missing25",
            missing,
            CorruptionConfig(random_missing_touch_probability=0.25),
        ),
    ]


def run(source: str) -> list[dict[str, Any]]:
    declaration = development_declaration()
    records: list[dict[str, Any]] = []
    for index, (world_id, config, corruption) in enumerate(_worlds()):
        pristine = generate_world(config)
        observed = (
            corrupt_world(pristine, corruption, seed=9100 + index)
            if corruption is not None
            else pristine
        )
        truth = tuple(
            sorted(
                (channel.value, effect)
                for channel, effect in pristine.manifest.incremental_effect_map().items()
            )
        )
        result = evaluate_known_case(
            declaration,
            source,
            dataset=to_observable_dataset(observed.dataset),
            synthetic_truth=truth,
            stage=EvaluationStage.DEVELOPMENT,
            family=world_id,
        )
        records.append(
            {
                "label": "DEVELOPMENT",
                "world_id": world_id,
                "seed": config.seed,
                "n_subjects": config.n_subjects,
                "corruption": (
                    "random_missing_touch_probability=0.25"
                    if corruption is not None
                    else "none"
                ),
                "status": result.status.value,
                "metrics": dict(result.metrics),
                "uncertainty_present": result.uncertainty_present,
            }
        )
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--candidate-source",
        default="phase2/candidates/candidate1/candidate.py",
    )
    parser.add_argument("--output", default="candidate1_development_results.json")
    args = parser.parse_args()
    source = Path(args.candidate_source).read_text(encoding="utf-8")
    records = run(source)
    Path(args.output).write_text(
        json.dumps(records, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(records, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

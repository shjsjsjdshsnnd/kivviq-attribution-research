from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from attribution_lab.phase2.constants import FROZEN_PHASE1_COMMIT
from attribution_lab.phase2.phase1_adapter import FrozenPhase1Adapter
from attribution_lab.phase2_evaluator.evaluator import evaluate_known_case
from attribution_lab.phase2_evaluator.isolation import CandidateRunner
from attribution_lab.phase2_evaluator.results import EvaluationStage
from attribution_lab.runner import quick_benchmark_specs
from phase2_candidate_sdk import DeclaredContext, fingerprint_payload
from research.candidate1.development_worlds import development_worlds
from research.candidate1.preregistration import DECLARATION, DEVELOPMENT_RECORD


def _source() -> str:
    return (Path(__file__).with_name("candidate.py")).read_text(encoding="utf-8")


def _response(
    source: str,
    case,
    *,
    family: str,
):
    context = DeclaredContext(
        stage=EvaluationStage.FROZEN_PHASE1.value,
        scenario_family=family,
        estimand_fingerprint=fingerprint_payload(asdict(DECLARATION.estimand)),
        phase1_reference=FROZEN_PHASE1_COMMIT,
        holdout_version=None,
    )
    return CandidateRunner().execute(source, case.observable_dataset, context)


def _finite_mapping(values: dict[str, float]) -> bool:
    return all(value == value and abs(value) != float("inf") for value in values.values())


def run() -> dict[str, Any]:
    source = _source()
    development_results: list[dict[str, Any]] = []
    for world in development_worlds():
        result = evaluate_known_case(
            DECLARATION,
            source,
            dataset=world.dataset,
            synthetic_truth=world.synthetic_truth,
            stage=EvaluationStage.DEVELOPMENT,
            family=world.world_id,
        )
        development_results.append(asdict(result))

    phase1_results: list[dict[str, Any]] = []
    cases: dict[tuple[str, str], Any] = {}
    for spec in quick_benchmark_specs():
        case = FrozenPhase1Adapter.build_case(
            spec.scenario,
            seed=spec.seed,
            sample_size=spec.sample_size,
            observation_quality=spec.observation_quality,
        )
        cases[(spec.scenario, spec.observation_quality)] = case
        result = evaluate_known_case(
            DECLARATION,
            source,
            dataset=case.observable_dataset,
            synthetic_truth=case.synthetic_truth,
            stage=EvaluationStage.FROZEN_PHASE1,
            family=f"{spec.scenario}:{spec.observation_quality}",
            phase1_reference=case.phase1_reference,
        )
        phase1_results.append(asdict(result))

    required = {
        "demand_capture": ("google_brand", 0.03),
        "retargeting_selection": ("meta", 0.03),
        "null_paid_channel": ("pinterest", 0.03),
    }
    checks: dict[str, Any] = {}
    for scenario, (channel, tolerance) in required.items():
        case = cases[(scenario, "perfect")]
        response = _response(source, case, family=f"{scenario}:perfect")
        estimate = dict(response.estimates).get(channel)
        checks[f"{scenario}:{channel}:null_tolerance"] = {
            "estimate": estimate,
            "threshold": tolerance,
            "pass": estimate is not None and abs(estimate) <= tolerance,
        }

    harmful_case = cases[("harmful_channel", "perfect")]
    harmful_response = _response(source, harmful_case, family="harmful_channel:perfect")
    harmful_estimate = dict(harmful_response.estimates).get("pinterest")
    checks["harmful_channel:pinterest:negative"] = {
        "estimate": harmful_estimate,
        "pass": harmful_estimate is not None and harmful_estimate < 0.0,
    }

    perfect = cases[("balanced_multi_touch", "perfect")]
    missing_50 = cases[("balanced_multi_touch", "missing_50")]
    perfect_response = _response(source, perfect, family="balanced_multi_touch:perfect")
    missing_response = _response(source, missing_50, family="balanced_multi_touch:missing_50")
    perfect_map = dict(perfect_response.estimates)
    missing_map = dict(missing_response.estimates)
    shared = sorted(set(perfect_map) & set(missing_map))
    degradation = (
        sum(abs(perfect_map[key] - missing_map[key]) for key in shared) / len(shared)
        if shared
        else float("inf")
    )
    checks["measurement_loss:missing_50"] = {
        "mean_absolute_channel_change": degradation,
        "threshold": 0.20,
        "pass": degradation <= 0.20,
    }

    small_case = FrozenPhase1Adapter.build_case(
        "balanced_multi_touch",
        seed=7,
        sample_size=80,
        observation_quality="perfect",
    )
    small_response = _response(source, small_case, family="small_sample_80")
    small_map = dict(small_response.estimates)
    checks["small_sample_80:numerical_validity"] = {
        "pass": bool(small_map)
        and _finite_mapping(small_map)
        and small_response.uncertainty is not None,
    }

    phase1_pass = all(bool(check["pass"]) for check in checks.values())
    return {
        "candidate_id": DECLARATION.candidate_id,
        "candidate_version": DECLARATION.version,
        "declaration_fingerprint": DECLARATION.fingerprint,
        "development_record_fingerprint": DEVELOPMENT_RECORD.fingerprint,
        "source_fingerprint": fingerprint_payload({"source": source.replace("\r\n", "\n")}),
        "phase1_reference": FROZEN_PHASE1_COMMIT,
        "development_results": development_results,
        "frozen_phase1_results": phase1_results,
        "preregistered_phase1_checks": checks,
        "preholdout_gate_pass": phase1_pass,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    payload = run()
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        "Candidate 1 pre-holdout evaluation complete: "
        f"preholdout_gate_pass={payload['preholdout_gate_pass']}"
    )


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json
import math
import shutil
import statistics
import subprocess
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from attribution_lab.phase2.constants import (
    EVALUATION_PROTOCOL_VERSION,
    FROZEN_PHASE1_COMMIT,
)
from attribution_lab.phase2.development import DevelopmentWorldRecord
from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2.registration import CandidateRegistry
from attribution_lab.phase2_evaluator.evaluator import HoldoutEvaluator
from attribution_lab.phase2_evaluator.gates import apply_preregistered_gate
from attribution_lab.phase2_evaluator.isolation import CandidateRunner
from attribution_lab.phase2_evaluator.ledger import (
    EvaluationLedgerEntry,
    HoldoutExposureEventType,
    ResearchLedger,
)
from attribution_lab.phase2_evaluator.results import (
    REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    EvaluationStage,
    GateOutcome,
    ScenarioStatus,
    SeparatedEvaluationReport,
)
from attribution_lab.phase2_evaluator.seals import HoldoutSealStore
from attribution_lab.runner import (
    FULL_SCENARIOS,
    OBSERVATION_QUALITIES,
    RESEARCH_SEEDS,
    ExperimentSpec,
    _quality_seed,
    corruption_for_quality,
)
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world
from attribution_lab.stress.corruption import corrupt_world
from phase2_candidate_sdk import (
    CandidateDeclaration,
    DeclaredContext,
    EstimandDefinition,
    EstimandKind,
    FalsificationCriteria,
    FamilyCriterion,
    fingerprint_payload,
)


ROOT = Path(__file__).resolve().parents[1]
PROTOCOL_PATH = ROOT / "phase2" / "candidates" / "candidate1" / "frozen_protocol.json"
DEVELOPMENT_SUMMARY_PATH = (
    ROOT / "phase2" / "candidates" / "candidate1" / "development_summary.json"
)
CANDIDATE_SOURCE_PATH = ROOT / "phase2" / "candidates" / "candidate1" / "candidate.py"
DURABLE_REPORT_DIR = ROOT / "docs" / "candidates" / "candidate1-v1"


def _load_json(path: Path) -> dict[str, Any]:
    loaded = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return loaded


def _declaration(protocol: dict[str, Any]) -> CandidateDeclaration:
    estimand_payload = protocol["estimand"]
    criteria_payload = protocol["falsification_criteria"]
    return CandidateDeclaration(
        candidate_id=str(protocol["candidate_id"]),
        version=str(protocol["version"]),
        estimand=EstimandDefinition(
            kind=EstimandKind(str(estimand_payload["kind"])),
            population=str(estimand_payload["population"]),
            treatment_or_exposure=str(estimand_payload["treatment_or_exposure"]),
            outcome=str(estimand_payload["outcome"]),
            horizon_hours=float(estimand_payload["horizon_hours"]),
            intervention=str(estimand_payload["intervention"]),
            comparison=str(estimand_payload["comparison"]),
            unit_of_analysis=str(estimand_payload["unit_of_analysis"]),
            temporal_ordering=str(estimand_payload["temporal_ordering"]),
            treatment_regime=str(estimand_payload["treatment_regime"]),
            aggregation_target=str(estimand_payload["aggregation_target"]),
        ),
        hypothesis=str(protocol["hypothesis"]),
        required_observable_inputs=tuple(
            str(value) for value in protocol["required_observable_inputs"]
        ),
        assumptions=tuple(str(value) for value in protocol["assumptions"]),
        supported_outcome_type=str(protocol["supported_outcome_type"]),
        negative_effects_representable=bool(protocol["negative_effects_representable"]),
        interactions_representable=bool(protocol["interactions_representable"]),
        uncertainty_method=str(protocol["uncertainty_method"]),
        hyperparameters=tuple(
            sorted(
                (str(key), str(value))
                for key, value in protocol["hyperparameters"].items()
            )
        ),
        hyperparameter_selection_procedure=str(
            protocol["hyperparameter_selection_procedure"]
        ),
        development_world_usage=tuple(
            str(value) for value in protocol["development_world_usage"]
        ),
        randomization_behavior=str(protocol["randomization_behavior"]),
        expected_failure_conditions=tuple(
            str(value) for value in protocol["expected_failure_conditions"]
        ),
        falsification_criteria=FalsificationCriteria(
            primary_success_criteria=tuple(
                str(value)
                for value in criteria_payload["primary_success_criteria"]
            ),
            failure_criteria=tuple(
                str(value) for value in criteria_payload["failure_criteria"]
            ),
            uncertainty_requirements=tuple(
                str(value)
                for value in criteria_payload["uncertainty_requirements"]
            ),
            robustness_requirements=tuple(
                str(value)
                for value in criteria_payload["robustness_requirements"]
            ),
            required_holdout_families=tuple(
                str(value)
                for value in criteria_payload["required_holdout_families"]
            ),
            family_rules=tuple(
                FamilyCriterion(
                    family=str(rule["family"]),
                    metric=str(rule["metric"]),
                    operator=str(rule["operator"]),
                    threshold=float(rule["threshold"]),
                )
                for rule in criteria_payload["family_rules"]
            ),
            known_unsupported_cases=tuple(
                str(value)
                for value in criteria_payload["known_unsupported_cases"]
            ),
        ),
    )


def _development_record(protocol: dict[str, Any]) -> DevelopmentWorldRecord:
    return DevelopmentWorldRecord(
        candidate_id=str(protocol["candidate_id"]),
        candidate_version=str(protocol["version"]),
        world_ids=tuple(str(value) for value in protocol["development_world_usage"]),
        parameter_ranges=(
            ("n_subjects", "600"),
            ("development_seeds", "1101,1102,1103,1104,1105"),
            ("ridge_lambda", "0.0001"),
            ("maximum_development_missing_touch_probability", "0.25"),
        ),
        architecture_selection_notes=(
            "One preregistered ridge-stabilized linear-probability outcome-regression "
            "family only; no competing estimator family was developed."
        ),
        hyperparameter_selection_notes=(
            "ridge_lambda=0.0001 fixed for numerical stabilization before frozen "
            "Phase 1 or holdout evaluation."
        ),
    )


def _git_blob(path: Path) -> str:
    return subprocess.run(
        ["git", "hash-object", str(path)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _verify_frozen_source(protocol: dict[str, Any]) -> None:
    actual = _git_blob(CANDIDATE_SOURCE_PATH)
    expected = str(protocol["candidate_source_blob_sha"])
    if actual != expected:
        raise RuntimeError(
            f"Candidate 1 source changed after protocol freeze: {actual} != {expected}"
        )


def _score_response(response: Any, truth: dict[str, float]) -> dict[str, Any]:
    estimates = dict(response.estimates)
    common = sorted(set(estimates) & set(truth))
    if not common:
        return {
            "mean_absolute_error": math.inf,
            "max_absolute_error": math.inf,
            "coverage_fraction": 0.0,
            "interval_coverage_fraction": 0.0,
            "mean_interval_width": math.inf,
            "channel_errors": {},
            "estimates": estimates,
        }
    errors = {key: abs(estimates[key] - truth[key]) for key in common}
    interval_coverage = 0.0
    mean_width = math.inf
    if response.uncertainty is not None:
        lower = dict(response.uncertainty.lower)
        upper = dict(response.uncertainty.upper)
        covered = [
            lower[key] <= truth[key] <= upper[key]
            for key in common
            if key in lower and key in upper
        ]
        widths = [
            upper[key] - lower[key]
            for key in common
            if key in lower and key in upper
        ]
        if len(covered) == len(common):
            interval_coverage = sum(int(value) for value in covered) / len(common)
        if len(widths) == len(common):
            mean_width = sum(widths) / len(widths)
    return {
        "mean_absolute_error": sum(errors.values()) / len(errors),
        "max_absolute_error": max(errors.values()),
        "coverage_fraction": len(common) / len(truth),
        "interval_coverage_fraction": interval_coverage,
        "mean_interval_width": mean_width,
        "channel_errors": errors,
        "estimates": estimates,
    }


def _phase1_grid() -> tuple[tuple[str, int, int, str], ...]:
    cases: set[tuple[str, int, int, str]] = set()
    for scenario in FULL_SCENARIOS:
        for seed in RESEARCH_SEEDS:
            cases.add((scenario, seed, 250, "perfect"))

    key_scenarios = (
        "demand_capture",
        "retargeting_selection",
        "null_paid_channel",
        "harmful_channel",
        "channel_interaction",
    )
    for scenario in key_scenarios:
        for seed in RESEARCH_SEEDS:
            for sample_size in (80, 250, 800):
                cases.add((scenario, seed, sample_size, "perfect"))

    for scenario in ("balanced_multi_touch", "retargeting_selection"):
        for seed in RESEARCH_SEEDS:
            for quality in OBSERVATION_QUALITIES:
                cases.add((scenario, seed, 250, quality))

    return tuple(sorted(cases))


def _run_phase1(
    declaration: CandidateDeclaration,
    source: str,
) -> list[dict[str, Any]]:
    runner = CandidateRunner()
    estimand_fingerprint = fingerprint_payload(asdict(declaration.estimand))
    records: list[dict[str, Any]] = []
    for scenario, seed, sample_size, quality in _phase1_grid():
        spec = ExperimentSpec(scenario, seed, sample_size, quality)
        pristine = generate_world(
            scenario_config(scenario, seed=seed, n_subjects=sample_size)
        )
        observed = corrupt_world(
            pristine,
            corruption_for_quality(quality),
            seed=_quality_seed(spec),
        )
        response = runner.execute(
            source,
            to_observable_dataset(observed.dataset),
            DeclaredContext(
                stage=EvaluationStage.FROZEN_PHASE1.value,
                scenario_family=scenario,
                estimand_fingerprint=estimand_fingerprint,
                phase1_reference=FROZEN_PHASE1_COMMIT,
                holdout_version=None,
                protocol_version=EVALUATION_PROTOCOL_VERSION,
            ),
        )
        truth = {
            channel.value: value
            for channel, value in pristine.manifest.incremental_effect_map().items()
        }
        metrics = _score_response(response, truth)
        records.append(
            {
                "scenario": scenario,
                "seed": seed,
                "sample_size": sample_size,
                "observation_quality": quality,
                "status": ScenarioStatus.EVALUATED.value,
                "metrics": {
                    key: value
                    for key, value in metrics.items()
                    if key not in {"channel_errors", "estimates"}
                },
                "channel_errors": metrics["channel_errors"],
                "estimates": metrics["estimates"],
                "truth": truth,
            }
        )
    return records


def _mean(records: list[dict[str, Any]], metric: str) -> float:
    values = [float(record["metrics"][metric]) for record in records]
    return statistics.mean(values) if values else math.inf


def _select(
    records: list[dict[str, Any]],
    *,
    scenario: str | None = None,
    quality: str | None = None,
    sample_size: int | None = None,
) -> list[dict[str, Any]]:
    result = records
    if scenario is not None:
        result = [record for record in result if record["scenario"] == scenario]
    if quality is not None:
        result = [
            record for record in result if record["observation_quality"] == quality
        ]
    if sample_size is not None:
        result = [record for record in result if record["sample_size"] == sample_size]
    return result


def _target_error(
    records: list[dict[str, Any]],
    scenario: str,
    channel: str,
) -> float:
    selected = _select(records, scenario=scenario, quality="perfect", sample_size=250)
    values = [float(record["channel_errors"][channel]) for record in selected]
    return statistics.mean(values) if values else math.inf


def _target_estimate(
    records: list[dict[str, Any]],
    scenario: str,
    channel: str,
) -> float:
    selected = _select(records, scenario=scenario, quality="perfect", sample_size=250)
    values = [float(record["estimates"][channel]) for record in selected]
    return statistics.mean(values) if values else math.inf


def _phase1_gate(
    records: list[dict[str, Any]],
    protocol: dict[str, Any],
) -> tuple[bool, dict[str, Any], list[str]]:
    thresholds = protocol["frozen_phase1_gate"]
    measurement_cases = [
        record
        for record in records
        if record["scenario"] in {"balanced_multi_touch", "retargeting_selection"}
    ]
    summary = {
        "cases": len(records),
        "overall_mean_absolute_error": _mean(records, "mean_absolute_error"),
        "minimum_channel_coverage_fraction": min(
            float(record["metrics"]["coverage_fraction"]) for record in records
        ),
        "mean_interval_coverage_fraction": _mean(
            records, "interval_coverage_fraction"
        ),
        "demand_capture_google_brand_mean_abs_error": _target_error(
            records, "demand_capture", "google_brand"
        ),
        "retargeting_selection_meta_mean_abs_error": _target_error(
            records, "retargeting_selection", "meta"
        ),
        "null_paid_pinterest_mean_abs_error": _target_error(
            records, "null_paid_channel", "pinterest"
        ),
        "harmful_pinterest_mean_abs_error": _target_error(
            records, "harmful_channel", "pinterest"
        ),
        "harmful_pinterest_mean_estimate": _target_estimate(
            records, "harmful_channel", "pinterest"
        ),
        "missing50_mean_absolute_error": _mean(
            [
                record
                for record in measurement_cases
                if record["observation_quality"] == "missing_50"
            ],
            "mean_absolute_error",
        ),
        "identity_fragmentation_mean_absolute_error": _mean(
            [
                record
                for record in measurement_cases
                if record["observation_quality"] == "fragmented_identity"
            ],
            "mean_absolute_error",
        ),
        "small_sample_n80_mean_absolute_error": _mean(
            [
                record
                for record in records
                if record["sample_size"] == 80
                and record["observation_quality"] == "perfect"
            ],
            "mean_absolute_error",
        ),
    }
    checks = {
        "overall_mean_absolute_error": summary["overall_mean_absolute_error"]
        <= float(thresholds["overall_mean_absolute_error_max"]),
        "channel_coverage": summary["minimum_channel_coverage_fraction"]
        >= float(thresholds["minimum_channel_coverage_fraction"]),
        "interval_coverage": summary["mean_interval_coverage_fraction"]
        >= float(thresholds["minimum_interval_coverage_fraction"]),
        "demand_capture": summary["demand_capture_google_brand_mean_abs_error"]
        <= float(thresholds["demand_capture_google_brand_mean_abs_error_max"]),
        "retargeting_selection": summary["retargeting_selection_meta_mean_abs_error"]
        <= float(thresholds["retargeting_selection_meta_mean_abs_error_max"]),
        "null_paid": summary["null_paid_pinterest_mean_abs_error"]
        <= float(thresholds["null_paid_pinterest_mean_abs_error_max"]),
        "harmful_error": summary["harmful_pinterest_mean_abs_error"]
        <= float(thresholds["harmful_pinterest_mean_abs_error_max"]),
        "harmful_sign": summary["harmful_pinterest_mean_estimate"] < 0.0,
        "missing50": summary["missing50_mean_absolute_error"]
        <= float(thresholds["missing50_mean_absolute_error_max"]),
        "identity_fragmentation": summary[
            "identity_fragmentation_mean_absolute_error"
        ]
        <= float(thresholds["identity_fragmentation_mean_absolute_error_max"]),
        "small_sample": summary["small_sample_n80_mean_absolute_error"]
        <= float(thresholds["small_sample_n80_mean_absolute_error_max"]),
    }
    summary["checks"] = checks
    reasons = [name for name, passed in checks.items() if not passed]
    return not reasons, summary, reasons


def _robustness_summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    measurement = [
        record
        for record in records
        if record["scenario"] in {"balanced_multi_touch", "retargeting_selection"}
        and record["sample_size"] == 250
    ]
    by_quality = {
        quality: _mean(
            [record for record in measurement if record["observation_quality"] == quality],
            "mean_absolute_error",
        )
        for quality in OBSERVATION_QUALITIES
    }
    key_perfect = [
        record
        for record in records
        if record["scenario"]
        in {
            "demand_capture",
            "retargeting_selection",
            "null_paid_channel",
            "harmful_channel",
            "channel_interaction",
        }
        and record["observation_quality"] == "perfect"
    ]
    by_sample_size = {
        str(size): _mean(
            [record for record in key_perfect if record["sample_size"] == size],
            "mean_absolute_error",
        )
        for size in (80, 250, 800)
    }
    seed_values = [
        float(record["metrics"]["mean_absolute_error"])
        for record in key_perfect
        if record["sample_size"] == 250
    ]
    return {
        "label": "PREREGISTERED_ROBUSTNESS",
        "mean_absolute_error_by_measurement_quality": by_quality,
        "mean_absolute_error_by_key_sample_size": by_sample_size,
        "key_case_seed_error_stddev": (
            statistics.pstdev(seed_values) if len(seed_values) > 1 else 0.0
        ),
        "mean_interval_coverage_fraction": _mean(
            records, "interval_coverage_fraction"
        ),
    }


def _write_report(
    output_dir: Path,
    payload: dict[str, Any],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "candidate1_results.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    lines = [
        "# Candidate 1 Phase 2 research result",
        "",
        f"**Candidate:** {payload['candidate_id']} @ {payload['version']}",
        f"**Frozen source fingerprint:** {payload['candidate_fingerprints']['code']}",
        f"**Final outcome:** **{payload['final_outcome']}**",
        "",
        "## Public holdout limitation",
        "",
        payload["public_holdout_limitation"],
        "",
        "## Frozen Phase 1",
        "",
        f"- Gate passed: {payload['frozen_phase1']['passed']}",
        f"- Cases evaluated: {payload['frozen_phase1']['summary']['cases']}",
        f"- Overall mean absolute error: {payload['frozen_phase1']['summary']['overall_mean_absolute_error']:.4f}",
        f"- Retargeting-selection target error: {payload['frozen_phase1']['summary']['retargeting_selection_meta_mean_abs_error']:.4f}",
        f"- Demand-capture target error: {payload['frozen_phase1']['summary']['demand_capture_google_brand_mean_abs_error']:.4f}",
        f"- Null-paid target error: {payload['frozen_phase1']['summary']['null_paid_pinterest_mean_abs_error']:.4f}",
        "",
        "## Sealed holdout",
        "",
        f"- Version: {payload['sealed_holdout']['version']}",
        f"- Feedback exposure consumed: {payload['sealed_holdout']['feedback_exposure_consumed']}",
        f"- Gate outcome: {payload['sealed_holdout']['gate_outcome']}",
        "",
        "| Family | MAE | Max error | Coverage | Interval coverage | Mean width |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for result in payload["sealed_holdout"]["results"]:
        metrics = result["metrics"]
        lines.append(
            f"| {result['family']} | {metrics.get('mean_absolute_error', float('nan')):.4f} "
            f"| {metrics.get('max_absolute_error', float('nan')):.4f} "
            f"| {metrics.get('coverage_fraction', float('nan')):.3f} "
            f"| {metrics.get('interval_coverage_fraction', float('nan')):.3f} "
            f"| {metrics.get('mean_interval_width', float('nan')):.4f} |"
        )
    lines.extend(
        [
            "",
            "## Robustness",
            "",
            "Robustness uses only the preregistered frozen Phase 1/public synthetic cases; "
            "the methodology was fixed before sealed-holdout exposure.",
            "",
            "## Interpretation",
            "",
            "SYNTHETIC CAUSAL RECOVERY is evidence about declared synthetic worlds only. "
            "This result is not production readiness, real-world causal accuracy, or proven incrementality.",
            "",
        ]
    )
    (output_dir / "candidate1_report.md").write_text(
        "\n".join(lines).rstrip() + "\n",
        encoding="utf-8",
    )


def preflight(output: Path) -> None:
    protocol = _load_json(PROTOCOL_PATH)
    _verify_frozen_source(protocol)
    declaration = _declaration(protocol)
    development = _development_record(protocol)
    source = CANDIDATE_SOURCE_PATH.read_text(encoding="utf-8")
    registry = CandidateRegistry(output / "registrations")
    registered = registry.register(
        declaration,
        source,
        development,
        registered_at="2030-01-01T00:00:00+00:00",
    )
    output.mkdir(parents=True, exist_ok=True)
    (output / "preflight.json").write_text(
        json.dumps(
            {
                "candidate_id": registered.candidate_id,
                "version": registered.version,
                "declaration_fingerprint": registered.declaration_fingerprint,
                "code_fingerprint": registered.code_fingerprint,
                "development_record_fingerprint": (
                    registered.development_record_fingerprint
                ),
                "lineage_fingerprint": registered.lineage_fingerprint,
                "source_blob_sha": protocol["candidate_source_blob_sha"],
                "holdout_exposure": "NOT_PERFORMED",
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    print((output / "preflight.json").read_text(encoding="utf-8"))


def evaluate(output: Path) -> None:
    protocol = _load_json(PROTOCOL_PATH)
    development_summary = _load_json(DEVELOPMENT_SUMMARY_PATH)
    _verify_frozen_source(protocol)
    declaration = _declaration(protocol)
    development = _development_record(protocol)
    source = CANDIDATE_SOURCE_PATH.read_text(encoding="utf-8")

    registry = CandidateRegistry(output / "registrations")
    registered = registry.register(declaration, source, development)

    phase1_records = _run_phase1(declaration, source)
    phase1_passed, phase1_summary, phase1_reasons = _phase1_gate(
        phase1_records,
        protocol,
    )
    robustness = _robustness_summary(phase1_records)

    holdout_results_payload: list[dict[str, Any]] = []
    holdout_gate_outcome = GateOutcome.INCONCLUSIVE
    holdout_gate_reasons: list[str] = []
    holdout_metadata: dict[str, Any] = {}
    feedback_consumed = False

    ledger_path = output / "research-ledger.jsonl"
    existing_ledger = DURABLE_REPORT_DIR / "research-ledger.jsonl"
    if existing_ledger.exists() and not ledger_path.exists():
        shutil.copyfile(existing_ledger, ledger_path)
    ledger = ResearchLedger(ledger_path)

    if phase1_passed:
        seal_store = HoldoutSealStore(output / "evaluator-private-seal")
        metadata = seal_store.create(str(protocol["sealed_holdout"]["version"]))
        holdout_metadata = metadata.as_dict()
        evaluator = HoldoutEvaluator(seal_store, registry, ledger)
        holdout_results = evaluator.evaluate(
            declaration,
            source,
            holdout_version=metadata.version,
        )
        exposure_events = ledger.exposure_entries()
        feedback_consumed = (
            sum(
                event.event_type == HoldoutExposureEventType.FEEDBACK_CONSUMED
                for event in exposure_events
            )
            == 1
        )
        report = SeparatedEvaluationReport(
            development_results=(),
            frozen_phase1_results=(),
            sealed_holdout_results=holdout_results,
            holdout_limitation_disclosure=REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
        )
        decision = apply_preregistered_gate(report, declaration)
        holdout_gate_outcome = decision.outcome
        holdout_gate_reasons = list(decision.reasons)
        holdout_results_payload = [
            {
                "family": result.family,
                "status": result.status.value,
                "metrics": dict(result.metrics),
                "uncertainty_present": result.uncertainty_present,
                "reason": result.reason,
            }
            for result in holdout_results
        ]
    else:
        holdout_gate_reasons = [
            "sealed holdout not consumed because frozen Phase 1 preregistered gate failed"
        ]

    robustness_passed = (
        robustness["mean_absolute_error_by_measurement_quality"]["missing_50"]
        <= float(
            protocol["frozen_phase1_gate"]["missing50_mean_absolute_error_max"]
        )
        and robustness["mean_absolute_error_by_measurement_quality"][
            "fragmented_identity"
        ]
        <= float(
            protocol["frozen_phase1_gate"][
                "identity_fragmentation_mean_absolute_error_max"
            ]
        )
        and robustness["mean_absolute_error_by_key_sample_size"]["80"]
        <= float(
            protocol["frozen_phase1_gate"]["small_sample_n80_mean_absolute_error_max"]
        )
        and robustness["mean_interval_coverage_fraction"]
        >= float(
            protocol["frozen_phase1_gate"]["minimum_interval_coverage_fraction"]
        )
    )

    final_reasons = [f"FROZEN_PHASE1:{reason}" for reason in phase1_reasons]
    if not robustness_passed:
        final_reasons.append("PREREGISTERED_ROBUSTNESS_GATE_FAILED")
    final_reasons.extend(f"SEALED_HOLDOUT:{reason}" for reason in holdout_gate_reasons)

    if not phase1_passed or not robustness_passed:
        final_outcome = GateOutcome.REJECT
    elif holdout_gate_outcome == GateOutcome.REJECT:
        final_outcome = GateOutcome.REJECT
    elif holdout_gate_outcome == GateOutcome.INCONCLUSIVE:
        final_outcome = GateOutcome.INCONCLUSIVE
    else:
        final_outcome = GateOutcome.SURVIVE

    ledger.append(
        EvaluationLedgerEntry(
            candidate_id=declaration.candidate_id,
            candidate_version=declaration.version,
            estimand_declaration_fingerprint=fingerprint_payload(
                asdict(declaration.estimand)
            ),
            hypothesis_fingerprint=fingerprint_payload(
                {"hypothesis": declaration.hypothesis}
            ),
            candidate_code_fingerprint=registered.code_fingerprint,
            development_world_record_fingerprint=(
                registered.development_record_fingerprint
            ),
            phase1_reference=FROZEN_PHASE1_COMMIT,
            holdout_version=str(protocol["sealed_holdout"]["version"]),
            evaluation_timestamp=datetime.now(UTC).isoformat(),
            evaluation_protocol_version=EVALUATION_PROTOCOL_VERSION,
            results=(
                ("frozen_phase1_gate", str(phase1_passed)),
                ("sealed_holdout_gate", holdout_gate_outcome.value),
            ),
            uncertainty=(
                (
                    "frozen_phase1_mean_interval_coverage",
                    str(robustness["mean_interval_coverage_fraction"]),
                ),
            ),
            robustness_results=(
                ("robustness_gate", str(robustness_passed)),
                (
                    "missing50_mae",
                    str(
                        robustness["mean_absolute_error_by_measurement_quality"][
                            "missing_50"
                        ]
                    ),
                ),
                (
                    "n80_mae",
                    str(robustness["mean_absolute_error_by_key_sample_size"]["80"]),
                ),
            ),
            outcome=final_outcome.value,
            rejection_reasons=tuple(final_reasons),
        )
    )
    ledger.verify()

    payload = {
        "candidate_id": declaration.candidate_id,
        "version": declaration.version,
        "candidate_fingerprints": {
            "declaration": registered.declaration_fingerprint,
            "code": registered.code_fingerprint,
            "development_record": registered.development_record_fingerprint,
            "lineage": registered.lineage_fingerprint,
            "source_git_blob": protocol["candidate_source_blob_sha"],
        },
        "development": development_summary,
        "frozen_phase1": {
            "passed": phase1_passed,
            "summary": phase1_summary,
            "rejection_reasons": phase1_reasons,
            "case_count": len(phase1_records),
        },
        "sealed_holdout": {
            "version": protocol["sealed_holdout"]["version"],
            "public_metadata": holdout_metadata,
            "feedback_exposure_consumed": feedback_consumed,
            "feedback_consumed_count": sum(
                event.event_type == HoldoutExposureEventType.FEEDBACK_CONSUMED
                for event in ledger.exposure_entries()
            ),
            "gate_outcome": holdout_gate_outcome.value,
            "gate_reasons": holdout_gate_reasons,
            "results": holdout_results_payload,
        },
        "robustness": {
            "passed": robustness_passed,
            "summary": robustness,
        },
        "public_holdout_limitation": REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
        "limitations": [
            "The holdout-family architecture is public; only instantiated holdout parameters are sealed.",
            "Candidate 1 adjusts only for observable proxies and cannot guarantee identification under hidden confounding.",
            "The estimator does not explicitly model interactions, heterogeneous treatment effects, or continuous-time effects.",
            "Synthetic causal recovery does not establish real-world causal accuracy.",
            "The evaluator-private holdout seal is intentionally not committed to this public repository.",
        ],
        "final_outcome": final_outcome.value,
        "final_reasons": final_reasons,
        "no_private_or_production_data_accessed": True,
        "phase1_reference": FROZEN_PHASE1_COMMIT,
        "harness_reference": protocol["parent_harness_commit"],
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "frozen_phase1_records.json").write_text(
        json.dumps(phase1_records, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output / "robustness.json").write_text(
        json.dumps(robustness, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output / "holdout_public_metadata.json").write_text(
        json.dumps(holdout_metadata, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    _write_report(output, payload)
    print(json.dumps(payload, indent=2, sort_keys=True))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("preflight", "evaluate"), required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    if args.mode == "preflight":
        preflight(output)
    else:
        evaluate(output)


if __name__ == "__main__":
    main()

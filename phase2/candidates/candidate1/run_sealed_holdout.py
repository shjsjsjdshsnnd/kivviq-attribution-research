from __future__ import annotations

# ruff: noqa: I001

import json
import tempfile
from dataclasses import asdict
from pathlib import Path

from attribution_lab.phase2.registration import CandidateRegistry
from attribution_lab.phase2_evaluator.evaluator import HoldoutEvaluator
from attribution_lab.phase2_evaluator.gates import apply_preregistered_gate
from attribution_lab.phase2_evaluator.ledger import (
    HoldoutExposureEventType,
    ResearchLedger,
)
from attribution_lab.phase2_evaluator.results import (
    REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    SeparatedEvaluationReport,
)
from attribution_lab.phase2_evaluator.seals import HoldoutSealStore
from phase2_candidate_sdk import fingerprint_payload

from candidate_definition import build_declaration, build_development_record


ROOT = Path(__file__).resolve().parent
HOLDOUT_VERSION = "candidate1-holdout-v1"


def _phase1_results() -> dict[str, object]:
    return json.loads(
        (ROOT / "frozen_phase1_results.json").read_text(encoding="utf-8")
    )


def _format(value: object) -> str:
    return f"{float(value):.4f}"


def main() -> None:
    declaration = build_declaration()
    development = build_development_record()
    source = (ROOT / "model.py").read_text(encoding="utf-8")
    ledger = ResearchLedger(ROOT / "research_state" / "research-ledger.jsonl")
    exposure_events = ledger.exposure_entries()
    consumed = [
        event
        for event in exposure_events
        if event.event_type == HoldoutExposureEventType.FEEDBACK_CONSUMED
        and event.holdout_version == HOLDOUT_VERSION
    ]
    prior_results = [
        event
        for event in exposure_events
        if event.event_type == HoldoutExposureEventType.FEEDBACK_RESULT
        and event.holdout_version == HOLDOUT_VERSION
    ]
    if len(consumed) != 1 or prior_results:
        raise RuntimeError("Candidate 1 holdout exposure ledger is not in consumable state")

    with tempfile.TemporaryDirectory(prefix="candidate1-sealed-") as directory:
        work = Path(directory)
        registry = CandidateRegistry(work / "registrations")
        identity = registry.register(
            declaration,
            source,
            development,
            registered_at="2026-09-20T17:45:00+00:00",
        )
        if identity.lineage_fingerprint != consumed[0].lineage_fingerprint:
            raise RuntimeError("consumed holdout lineage differs from frozen candidate")

        seals = HoldoutSealStore(work / "seals")
        metadata = seals.create(HOLDOUT_VERSION)
        evaluator = HoldoutEvaluator(seals, registry, ledger)
        results = evaluator._run_holdout(  # evaluator-only orchestration
            declaration,
            source,
            holdout_version=HOLDOUT_VERSION,
        )
        result_digest = fingerprint_payload([asdict(result) for result in results])
        evaluator.exposure.record_feedback_result(
            identity,
            HOLDOUT_VERSION,
            result_digest,
        )

    separated = SeparatedEvaluationReport(
        development_results=(),
        frozen_phase1_results=(),
        sealed_holdout_results=results,
        holdout_limitation_disclosure=REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    )
    holdout_decision = apply_preregistered_gate(separated, declaration)
    phase1 = _phase1_results()
    phase1_pass = bool(phase1["overall_preregistered_phase1_pass"])
    final_outcome = (
        holdout_decision.outcome.value
        if phase1_pass
        else "REJECT"
    )
    rejection_reasons = list(holdout_decision.reasons)
    if not phase1_pass:
        rejection_reasons.insert(
            0,
            "FROZEN_PHASE1 preregistered criteria failed: known-zero/selection behavior.",
        )

    public_results = [
        {
            "family": result.family,
            "status": result.status.value,
            "metrics": dict(result.metrics),
            "uncertainty_present": result.uncertainty_present,
            "reason": result.reason,
        }
        for result in results
    ]
    payload = {
        "stage": "SEALED_HOLDOUT",
        "candidate_id": declaration.candidate_id,
        "candidate_version": declaration.version,
        "holdout_version": metadata.version,
        "holdout_generator_fingerprint": metadata.generator_fingerprint,
        "holdout_configuration_fingerprint": metadata.configuration_fingerprint,
        "evaluation_protocol_version": metadata.evaluation_protocol_version,
        "feedback_bearing_exposure_count": 1,
        "exposure_state": "CONSUMED",
        "results_by_family": public_results,
        "holdout_gate_outcome": holdout_decision.outcome.value,
        "holdout_gate_reasons": list(holdout_decision.reasons),
        "frozen_phase1_gate_pass": phase1_pass,
        "final_candidate_outcome": final_outcome,
        "final_rejection_reasons": rejection_reasons,
        "holdout_limitation_disclosure": REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    }
    (ROOT / "sealed_holdout_results.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    phase1_criteria = phase1["criteria"]
    lines = [
        "# Candidate 1 final research report",
        "",
        f"Candidate: `{declaration.candidate_id}` v`{declaration.version}`",
        "",
        "## DEVELOPMENT",
        "",
        "The preregistered ridge grid was evaluated on development worlds only. "
        "Ridge λ=1.0 was selected before frozen Phase 1 or holdout evaluation.",
        "",
        "Development mean effect MAE at λ=1.0: **0.0272**.",
        "",
        "## FROZEN_PHASE1",
        "",
        f"- Perfect-observation mean effect MAE: **{_format(phase1_criteria['perfect_observation_mean_effect_mae']['value'])}**",
        f"- Mean interval coverage: **{_format(phase1_criteria['mean_interval_coverage_fraction']['value'])}**",
        f"- Missing-25 effect-vector divergence: **{_format(phase1_criteria['balanced_missing_25_l1_from_perfect']['value'])}**",
        f"- Missing-50 effect-vector divergence: **{_format(phase1_criteria['balanced_missing_50_l1_from_perfect']['value'])}**",
        f"- Harmful-channel negative sign: **{'PASS' if phase1_criteria['harmful_channel_negative_sign']['pass'] else 'FAIL'}**",
        f"- Known-zero/selection criterion: **{'PASS' if phase1_criteria['known_zero_effects']['pass'] else 'FAIL'}**",
        "",
        "Candidate 1 failed its preregistered known-zero-effect requirement under "
        "demand capture and intent/retargeting selection. It was not modified.",
        "",
        "## SEALED_HOLDOUT",
        "",
        f"Holdout version: `{metadata.version}`",
        "",
        "| Family | MAE | Max error | Effect coverage | Interval coverage | Interval width | Status |",
        "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for result in public_results:
        metrics = result["metrics"]
        lines.append(
            "| {family} | {mae:.4f} | {max_error:.4f} | {coverage:.3f} | "
            "{interval:.3f} | {width:.4f} | {status} |".format(
                family=result["family"],
                mae=float(metrics.get("mean_absolute_error", float("nan"))),
                max_error=float(metrics.get("max_absolute_error", float("nan"))),
                coverage=float(metrics.get("coverage_fraction", float("nan"))),
                interval=float(
                    metrics.get("interval_coverage_fraction", float("nan"))
                ),
                width=float(metrics.get("mean_interval_width", float("nan"))),
                status=result["status"],
            )
        )
    lines.extend(
        [
            "",
            f"Sealed holdout gate: **{holdout_decision.outcome.value}**.",
            "",
            "## Robustness and uncertainty",
            "",
            "Robustness was preregistered and evaluated without methodology changes: "
            "repeated Phase 1 seeds, sample-size/sparsity checks, 25%/50% missing touches, "
            "identity/cookie/censoring conditions, and sealed holdout selection, temporal, "
            "interaction, negative/heterogeneous, sparse-identity and compounded-measurement families.",
            "",
            "Candidate uncertainty is an approximate 90% model-based Wald/delta interval. "
            "The evaluator—not Candidate 1—scores interval coverage against synthetic oracle truth.",
            "",
            "## Holdout limitation disclosure",
            "",
            REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
            "",
            "## Limitations",
            "",
            "- The outcome model uses additive binary channel indicators and does not explicitly model interactions or time-varying effects.",
            "- Hidden purchase intent is intentionally unavailable; conditional exchangeability can fail.",
            "- Wald/delta uncertainty conditions on the fitted outcome-model specification.",
            "- Synthetic causal recovery does not establish real-world causal validity.",
            "",
            "## Final outcome",
            "",
            f"**{final_outcome}**",
            "",
        ]
    )
    if rejection_reasons:
        lines.append("Reasons:")
        lines.extend(f"- {reason}" for reason in rejection_reasons)
        lines.append("")
    (ROOT / "candidate1_report.md").write_text(
        "\n".join(lines).rstrip() + "\n",
        encoding="utf-8",
    )
    print("CANDIDATE1_SEALED_RESULT=" + json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()

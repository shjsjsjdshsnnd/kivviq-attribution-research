from __future__ import annotations

# ruff: noqa: I001

import hashlib
import json
from pathlib import Path

from phase2_candidate3_estimator.model import estimate

from public_falsification_worlds import public_falsification_cases

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
MODEL = REPO / "src" / "phase2_candidate3_estimator" / "model.py"
INPUT = REPO / "src" / "phase2_candidate3_estimator" / "input.py"
FROZEN = ROOT / "FROZEN_IMPLEMENTATION.json"
PROTOCOL = ROOT / "PUBLIC_FALSIFICATION_PROTOCOL.json"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _verify_frozen() -> dict[str, object]:
    frozen = json.loads(FROZEN.read_text(encoding="utf-8"))
    if frozen["status"] != "FROZEN_BEFORE_PUBLIC_FALSIFICATION":
        raise RuntimeError("Candidate 3 is not frozen for public falsification")
    if _sha(MODEL) != frozen["code"]["model_sha256"]:
        raise RuntimeError("Candidate 3 model changed after freeze")
    if _sha(INPUT) != frozen["code"]["input_sha256"]:
        raise RuntimeError("Candidate 3 input contract changed after freeze")
    return frozen


def main() -> None:
    frozen = _verify_frozen()
    protocol = json.loads(PROTOCOL.read_text(encoding="utf-8"))
    records: list[dict[str, object]] = []
    scored_errors: list[float] = []
    coverage_hits = 0
    scored_estimate_expected = 0
    scored_estimate_correct = 0
    abstain_expected = 0
    abstain_correct = 0
    ato_targeting_expected = 0
    ato_targeting_correct = 0
    latent_disclaimer_ok = True
    ate_null_ok = True
    bootstrap_ok = True

    for public_case in public_falsification_cases():
        result = estimate(
            public_case.case,
            lineage_fingerprint=str(frozen["lineage_fingerprint"]),
            propensity_l2=float(frozen["hyperparameters"]["propensity_l2"]),
        )
        output = result.output
        decision = output.decision.value
        behavior_ok = decision == public_case.expected_decision

        if public_case.expected_decision.startswith("ABSTAIN_"):
            abstain_expected += 1
            abstain_correct += int(behavior_ok)
        elif public_case.effect_scored:
            scored_estimate_expected += 1
            scored_estimate_correct += int(behavior_ok)

        error = None
        covered = None
        closer_to_ato = None
        if (
            public_case.effect_scored
            and decision == "ESTIMATE_ATO"
            and output.estimate is not None
            and public_case.ato_truth is not None
        ):
            error = abs(output.estimate - public_case.ato_truth)
            scored_errors.append(error)
            covered = bool(
                output.interval_lower is not None
                and output.interval_upper is not None
                and output.interval_lower
                <= public_case.ato_truth
                <= output.interval_upper
            )
            coverage_hits += int(covered)
            if public_case.ato_vs_ate_targeting_required:
                ato_targeting_expected += 1
                closer_to_ato = bool(
                    public_case.ate_truth is not None
                    and abs(output.estimate - public_case.ato_truth)
                    < abs(output.estimate - public_case.ate_truth)
                )
                ato_targeting_correct += int(closer_to_ato)

        if decision == "ESTIMATE_ATO":
            bootstrap_ok = bootstrap_ok and (
                result.bootstrap_requested == 400
                and result.bootstrap_valid / result.bootstrap_requested >= 0.95
            )

        ate_null_ok = ate_null_ok and output.full_population_ate is None
        if public_case.family == "latent_confounding_nongoal":
            latent_disclaimer_ok = latent_disclaimer_ok and (
                "does not solve latent confounding"
                in output.latent_confounding_statement
            )

        records.append(
            {
                "case_id": public_case.case_id,
                "family": public_case.family,
                "expected_decision": public_case.expected_decision,
                "actual_decision": decision,
                "behavior_ok": behavior_ok,
                "effect_scored": public_case.effect_scored,
                "ato_truth": public_case.ato_truth if public_case.effect_scored else None,
                "ate_truth": public_case.ate_truth if public_case.effect_scored else None,
                "estimate": output.estimate,
                "interval_lower": output.interval_lower,
                "interval_upper": output.interval_upper,
                "absolute_ato_error": error,
                "interval_covers_ato": covered,
                "ato_vs_ate_targeting_required": (
                    public_case.ato_vs_ate_targeting_required
                ),
                "closer_to_ato_than_ate": closer_to_ato,
                "bootstrap_requested": result.bootstrap_requested,
                "bootstrap_valid": result.bootstrap_valid,
                "full_population_ate": output.full_population_ate,
                "latent_confounding_statement": output.latent_confounding_statement,
            }
        )

    gates = protocol["gates"]
    mean_error = sum(scored_errors) / len(scored_errors) if scored_errors else float("inf")
    max_error = max(scored_errors) if scored_errors else float("inf")
    estimate_accuracy = (
        scored_estimate_correct / scored_estimate_expected
        if scored_estimate_expected
        else 0.0
    )
    abstention_accuracy = (
        abstain_correct / abstain_expected if abstain_expected else 0.0
    )
    ato_targeting_accuracy = (
        ato_targeting_correct / ato_targeting_expected
        if ato_targeting_expected
        else 1.0
    )

    criteria = {
        "scored_estimate_decision_accuracy": {
            "value": estimate_accuracy,
            "threshold": gates["scored_estimate_decision_accuracy"],
            "pass": estimate_accuracy >= gates["scored_estimate_decision_accuracy"],
        },
        "abstention_reason_accuracy": {
            "value": abstention_accuracy,
            "threshold": gates["abstention_reason_accuracy"],
            "pass": abstention_accuracy >= gates["abstention_reason_accuracy"],
        },
        "ato_targeting_accuracy": {
            "value": ato_targeting_accuracy,
            "threshold": gates["ato_targeting_accuracy"],
            "pass": ato_targeting_accuracy >= gates["ato_targeting_accuracy"],
        },
        "mean_absolute_ato_error": {
            "value": mean_error,
            "threshold": gates["mean_absolute_ato_error_lte"],
            "pass": mean_error <= gates["mean_absolute_ato_error_lte"],
        },
        "max_absolute_ato_error": {
            "value": max_error,
            "threshold": gates["max_absolute_ato_error_lte"],
            "pass": max_error <= gates["max_absolute_ato_error_lte"],
        },
        "interval_coverage": {
            "hits": coverage_hits,
            "required": gates["interval_coverage_minimum_cases"],
            "denominator": gates["interval_coverage_denominator_cases"],
            "pass": coverage_hits >= gates["interval_coverage_minimum_cases"],
        },
        "bootstrap_contract": {"pass": bootstrap_ok},
        "full_population_ate_null": {"pass": ate_null_ok},
        "latent_confounding_disclaimer": {"pass": latent_disclaimer_ok},
    }
    overall = all(bool(value["pass"]) for value in criteria.values())

    payload = {
        "stage": "FROZEN_PUBLIC_FALSIFICATION",
        "suite": protocol["suite"],
        "candidate_id": frozen["candidate_id"],
        "candidate_version": frozen["candidate_version"],
        "lineage_fingerprint": frozen["lineage_fingerprint"],
        "cases_evaluated": len(records),
        "criteria": criteria,
        "eligible_for_sealed_holdout": overall,
        "candidate3_holdout_exposure_consumed": False,
        "records": records,
    }
    (ROOT / "public_falsification_results.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    lines = [
        "# Candidate 3 frozen public falsification",
        "",
        f"- Eligible for sealed holdout: **{overall}**",
        "- Candidate 3 sealed holdout exposure consumed: **False**",
        "",
        "## Gates",
        "",
    ]
    for name, value in criteria.items():
        lines.append(f"- {name}: **{'PASS' if value['pass'] else 'FAIL'}**")
    (ROOT / "public_falsification_report.md").write_text(
        "\n".join(lines).rstrip() + "\n",
        encoding="utf-8",
    )

    print(
        "CANDIDATE3_PUBLIC_FALSIFICATION="
        + json.dumps(
            {
                "eligible_for_sealed_holdout": overall,
                "criteria": criteria,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

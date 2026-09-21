from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from attribution_lab.phase2_evaluator.ledger import (
    EvaluationLedgerEntry,
    HoldoutExposureEventType,
    HoldoutExposureLedgerEntry,
    ResearchLedger,
)

PROTOCOL_VERSION = "candidate3-evaluation-v1"
HOLDOUT_VERSION = "candidate3-holdout-v1"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-root", required=True)
    parser.add_argument("--result", required=True)
    args = parser.parse_args()

    root = Path(args.candidate_root)
    candidate_dir = root / "phase2" / "candidates" / "candidate3"
    result_path = Path(args.result)
    frozen = json.loads(
        (candidate_dir / "FROZEN_IMPLEMENTATION.json").read_text(encoding="utf-8")
    )
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result_digest = _sha(result_path)

    ledger = ResearchLedger(
        candidate_dir / "research_state" / "research-ledger.jsonl"
    )
    exposures = ledger.exposure_entries()
    consumed = [
        event
        for event in exposures
        if (
            event.event_type == HoldoutExposureEventType.FEEDBACK_CONSUMED
            and event.lineage_fingerprint == frozen["lineage_fingerprint"]
            and event.holdout_version == HOLDOUT_VERSION
            and event.evaluation_protocol_version == PROTOCOL_VERSION
        )
    ]
    prior_results = [
        event
        for event in exposures
        if (
            event.event_type == HoldoutExposureEventType.FEEDBACK_RESULT
            and event.lineage_fingerprint == frozen["lineage_fingerprint"]
            and event.holdout_version == HOLDOUT_VERSION
            and event.evaluation_protocol_version == PROTOCOL_VERSION
        )
    ]
    if len(consumed) != 1:
        raise RuntimeError("Candidate 3 requires exactly one consumed holdout exposure")
    if prior_results:
        raise RuntimeError("Candidate 3 feedback result has already been recorded")

    ledger.append(
        HoldoutExposureLedgerEntry(
            event_type=HoldoutExposureEventType.FEEDBACK_RESULT,
            candidate_id=str(frozen["candidate_id"]),
            candidate_version=str(frozen["candidate_version"]),
            lineage_fingerprint=str(frozen["lineage_fingerprint"]),
            declaration_fingerprint=str(frozen["contract_manifest_sha256"]),
            code_fingerprint=str(frozen["combined_code_fingerprint"]),
            development_record_fingerprint=str(
                frozen["development_results_sha256"]
            ),
            holdout_version=HOLDOUT_VERSION,
            evaluation_protocol_version=PROTOCOL_VERSION,
            event_timestamp=datetime.now(UTC).isoformat(),
            result_digest=result_digest,
            label="FEEDBACK_RESULT_FROZEN",
        )
    )

    criteria = result["criteria"]
    ledger.append(
        EvaluationLedgerEntry(
            candidate_id=str(frozen["candidate_id"]),
            candidate_version=str(frozen["candidate_version"]),
            estimand_declaration_fingerprint=str(
                frozen["contract_fingerprints"]["ato_estimand"]
            ),
            hypothesis_fingerprint=hashlib.sha256(
                b"candidate3-overlap-ato-support-aware-abstention-v1"
            ).hexdigest(),
            candidate_code_fingerprint=str(
                frozen["combined_code_fingerprint"]
            ),
            development_world_record_fingerprint=str(
                frozen["development_results_sha256"]
            ),
            phase1_reference="1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf",
            holdout_version=HOLDOUT_VERSION,
            evaluation_timestamp=datetime.now(UTC).isoformat(),
            evaluation_protocol_version=PROTOCOL_VERSION,
            results=tuple(
                (name, "PASS" if bool(value["pass"]) else "FAIL")
                for name, value in sorted(criteria.items())
            ),
            uncertainty=(
                (
                    "interval_coverage",
                    json.dumps(criteria["interval_coverage"], sort_keys=True),
                ),
                (
                    "bootstrap_contract",
                    json.dumps(criteria["bootstrap_contract"], sort_keys=True),
                ),
            ),
            robustness_results=(
                (
                    "abstention_reason_accuracy",
                    json.dumps(
                        criteria["abstention_reason_accuracy"],
                        sort_keys=True,
                    ),
                ),
                (
                    "ato_targeting_accuracy",
                    json.dumps(criteria["ato_targeting_accuracy"], sort_keys=True),
                ),
            ),
            outcome=str(result["outcome"]),
            rejection_reasons=tuple(str(reason) for reason in result["reasons"]),
        )
    )

    final = {
        "candidate_id": frozen["candidate_id"],
        "candidate_version": frozen["candidate_version"],
        "lineage_fingerprint": frozen["lineage_fingerprint"],
        "final_outcome": result["outcome"],
        "reasons": result["reasons"],
        "holdout_version": HOLDOUT_VERSION,
        "feedback_bearing_exposure_count": 1,
        "result_digest": result_digest,
        "criteria": criteria,
        "design_failures": result["design_failures"],
        "full_population_ate_estimated": False,
        "candidate1_status": "REJECT_FROZEN_UNTOUCHED",
        "candidate2_status": "REJECT_FROZEN_UNTOUCHED",
        "candidate3_contracts_frozen": True,
        "candidate3_public_falsification_passed": True,
        "no_merge_or_deploy": True,
    }
    (candidate_dir / "candidate3_final.json").write_text(
        json.dumps(final, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print("CANDIDATE3_FINAL=" + json.dumps(final, sort_keys=True))


if __name__ == "__main__":
    main()

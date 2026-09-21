from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from attribution_lab.phase2_evaluator.ledger import (
    HoldoutExposureEventType,
    HoldoutExposureLedgerEntry,
    ResearchLedger,
)

PROTOCOL_VERSION = "candidate3-evaluation-v1"
HOLDOUT_VERSION = "candidate3-holdout-v1"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-root", required=True)
    args = parser.parse_args()

    root = Path(args.candidate_root)
    candidate_dir = root / "phase2" / "candidates" / "candidate3"
    frozen = json.loads(
        (candidate_dir / "FROZEN_IMPLEMENTATION.json").read_text(encoding="utf-8")
    )
    public = json.loads(
        (candidate_dir / "public_falsification_results.json").read_text(
            encoding="utf-8"
        )
    )
    if not bool(public["eligible_for_sealed_holdout"]):
        raise RuntimeError("Candidate 3 did not pass frozen public falsification")
    if bool(public["candidate3_holdout_exposure_consumed"]):
        raise RuntimeError("public result already claims holdout exposure")
    if frozen["holdout_version"] != HOLDOUT_VERSION:
        raise RuntimeError("frozen Candidate 3 holdout version changed")

    ledger_path = candidate_dir / "research_state" / "research-ledger.jsonl"
    ledger = ResearchLedger(ledger_path)
    for event in ledger.exposure_entries():
        if (
            event.event_type == HoldoutExposureEventType.FEEDBACK_CONSUMED
            and event.lineage_fingerprint == frozen["lineage_fingerprint"]
            and event.holdout_version == HOLDOUT_VERSION
            and event.evaluation_protocol_version == PROTOCOL_VERSION
        ):
            raise RuntimeError(
                "Candidate 3 sealed holdout feedback has already been consumed"
            )

    entry = HoldoutExposureLedgerEntry(
        event_type=HoldoutExposureEventType.FEEDBACK_CONSUMED,
        candidate_id=str(frozen["candidate_id"]),
        candidate_version=str(frozen["candidate_version"]),
        lineage_fingerprint=str(frozen["lineage_fingerprint"]),
        declaration_fingerprint=str(frozen["contract_manifest_sha256"]),
        code_fingerprint=str(frozen["combined_code_fingerprint"]),
        development_record_fingerprint=str(frozen["development_results_sha256"]),
        holdout_version=HOLDOUT_VERSION,
        evaluation_protocol_version=PROTOCOL_VERSION,
        event_timestamp=datetime.now(UTC).isoformat(),
        result_digest=None,
        label="FEEDBACK_BEARING_EVALUATION_CONSUMED",
    )
    ledger.append(entry)
    state = {
        "candidate_id": frozen["candidate_id"],
        "candidate_version": frozen["candidate_version"],
        "lineage_fingerprint": frozen["lineage_fingerprint"],
        "holdout_version": HOLDOUT_VERSION,
        "evaluation_protocol_version": PROTOCOL_VERSION,
        "state": "CONSUMED",
        "feedback_bearing_exposure_count": 1,
    }
    (candidate_dir / "holdout_exposure_state.json").write_text(
        json.dumps(state, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print("CANDIDATE3_HOLDOUT_EXPOSURE_CONSUMED=" + json.dumps(state, sort_keys=True))


if __name__ == "__main__":
    main()

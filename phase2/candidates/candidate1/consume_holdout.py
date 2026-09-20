from __future__ import annotations

import json
import tempfile
from pathlib import Path

from attribution_lab.phase2.registration import CandidateRegistry
from attribution_lab.phase2_evaluator.exposure import HoldoutExposureController
from attribution_lab.phase2_evaluator.ledger import ResearchLedger

from candidate_definition import build_declaration, build_development_record


ROOT = Path(__file__).resolve().parent
HOLDOUT_VERSION = "candidate1-holdout-v1"


def _verify_phase1_complete() -> None:
    payload = json.loads(
        (ROOT / "frozen_phase1_results.json").read_text(encoding="utf-8")
    )
    if payload.get("stage") != "FROZEN_PHASE1":
        raise RuntimeError("frozen Phase 1 evaluation result is missing or invalid")


def main() -> None:
    _verify_phase1_complete()
    declaration = build_declaration()
    development = build_development_record()
    source = (ROOT / "model.py").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="candidate1-consume-") as directory:
        registry = CandidateRegistry(directory)
        registered = registry.register(
            declaration,
            source,
            development,
            registered_at="2026-09-20T17:45:00+00:00",
        )
        manifest = json.loads(
            (ROOT / "freeze_manifest.json").read_text(encoding="utf-8")
        )
        if registered.lineage_fingerprint != manifest["lineage_fingerprint"]:
            raise RuntimeError("frozen Candidate 1 lineage changed")
        ledger = ResearchLedger(ROOT / "research_state" / "research-ledger.jsonl")
        HoldoutExposureController(registry, ledger).consume_feedback(
            declaration,
            source,
            HOLDOUT_VERSION,
        )
    print(
        "CANDIDATE1_HOLDOUT_CONSUMED="
        + json.dumps(
            {
                "candidate_id": declaration.candidate_id,
                "candidate_version": declaration.version,
                "holdout_version": HOLDOUT_VERSION,
                "state": "CONSUMED",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

from __future__ import annotations

# ruff: noqa: I001

import json
import tempfile
from dataclasses import asdict
from pathlib import Path

from attribution_lab.phase2.registration import CandidateRegistry

from candidate_definition import build_declaration, build_development_record

ROOT = Path(__file__).resolve().parent


def main() -> None:
    development = json.loads(
        (ROOT / "development_results.json").read_text(encoding="utf-8")
    )
    if float(development["selected_outcome_l2"]) != 5.0:
        raise RuntimeError("unexpected selected outcome L2")
    if float(development["selected_propensity_l2"]) != 5.0:
        raise RuntimeError("unexpected selected propensity L2")
    for forbidden_flag in (
        "candidate1_holdout_metrics_used_for_tuning",
        "frozen_phase1_used_for_tuning",
        "candidate2_holdout_used_for_tuning",
    ):
        if bool(development[forbidden_flag]):
            raise RuntimeError(f"development contamination detected: {forbidden_flag}")

    holdout_metadata = json.loads(
        (ROOT / "holdout_public_metadata.json").read_text(encoding="utf-8")
    )
    if holdout_metadata["version"] != "candidate2-holdout-v1":
        raise RuntimeError("Candidate 2 holdout version changed")
    if holdout_metadata["status"] != "SEALED_BEFORE_CANDIDATE2_IMPLEMENTATION":
        raise RuntimeError("Candidate 2 holdout was not sealed before implementation")
    if bool(holdout_metadata["candidate1_holdout_reused"]):
        raise RuntimeError("Candidate 1 holdout reuse is prohibited")

    declaration = build_declaration()
    development_record = build_development_record()
    source = (ROOT / "model.py").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="candidate2-freeze-") as directory:
        registered = CandidateRegistry(directory).register(
            declaration,
            source,
            development_record,
            registered_at="2026-09-20T22:23:00+00:00",
        )

    payload = {
        "candidate_id": registered.candidate_id,
        "candidate_version": registered.version,
        "declaration_fingerprint": registered.declaration_fingerprint,
        "code_fingerprint": registered.code_fingerprint,
        "development_record_fingerprint": registered.development_record_fingerprint,
        "lineage_fingerprint": registered.lineage_fingerprint,
        "estimand": asdict(declaration.estimand),
        "selected_hyperparameters": dict(declaration.hyperparameters),
        "holdout_version": holdout_metadata["version"],
        "holdout_generator_fingerprint": holdout_metadata["generator_fingerprint"],
        "holdout_configuration_fingerprint": holdout_metadata["configuration_fingerprint"],
        "holdout_creation_timestamp": holdout_metadata["creation_timestamp"],
        "holdout_sealed_before_implementation": True,
        "candidate1_holdout_metrics_used_for_tuning": False,
        "candidate1_status": "REJECT_FROZEN_HISTORICAL_COMPARATOR",
        "status": "FROZEN_BEFORE_PHASE1_EVALUATION",
    }
    (ROOT / "FROZEN.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print("CANDIDATE2_FREEZE=" + json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()

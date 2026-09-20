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
    declaration = build_declaration()
    development = build_development_record()
    source = (ROOT / "model.py").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="candidate1-freeze-") as directory:
        registered = CandidateRegistry(directory).register(
            declaration,
            source,
            development,
            registered_at="2026-09-20T17:45:00+00:00",
        )
    payload = {
        "candidate_id": registered.candidate_id,
        "candidate_version": registered.version,
        "declaration_fingerprint": registered.declaration_fingerprint,
        "code_fingerprint": registered.code_fingerprint,
        "development_record_fingerprint": registered.development_record_fingerprint,
        "lineage_fingerprint": registered.lineage_fingerprint,
        "selected_hyperparameters": dict(declaration.hyperparameters),
        "estimand": asdict(declaration.estimand),
        "status": "FROZEN_BEFORE_PHASE1_EVALUATION",
    }
    print("CANDIDATE1_FREEZE=" + json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()

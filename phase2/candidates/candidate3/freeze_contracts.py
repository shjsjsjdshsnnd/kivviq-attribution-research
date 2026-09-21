from __future__ import annotations

import hashlib
import json
from pathlib import Path

from phase2_candidate3_contracts.contracts import contract_bundle

ROOT = Path(__file__).resolve().parents[3]
CONTRACT_SOURCE = ROOT / "src" / "phase2_candidate3_contracts" / "contracts.py"
DOC = ROOT / "phase2" / "candidates" / "candidate3" / "CONTRACTS.md"
OUTPUT = ROOT / "phase2" / "candidates" / "candidate3" / "FROZEN_CONTRACTS.json"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if (ROOT / "phase2" / "candidates" / "candidate3" / "model.py").exists():
        raise RuntimeError("Candidate 3 estimator exists before contract freeze")
    bundle = contract_bundle()
    payload = {
        "candidate_id": "candidate3-overlap-ato",
        "candidate_version": "1.0.0",
        "status": "CONTRACTS_FROZEN_BEFORE_HOLDOUT_SEAL",
        "phase1_reference": "1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf",
        "harness_reference": "3616d00c0855a0d3d9dcb8dbf578a3e68c26f9fa",
        "identification_overlap_study_reference": (
            "cfdf9cc1c71e28366fe1c4b27968cf11e2faa14a"
        ),
        "contract_fingerprints": bundle["fingerprints"],
        "contract_source_sha256": _sha256(CONTRACT_SOURCE),
        "contract_document_sha256": _sha256(DOC),
        "estimator_implemented": False,
        "holdout_instantiated": False,
    }
    OUTPUT.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print("CANDIDATE3_CONTRACT_FREEZE=" + json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()

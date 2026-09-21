from __future__ import annotations

import hashlib
import json
from pathlib import Path

from phase2_candidate3_estimator.model import BOOTSTRAP_REPLICATES, PROPENSITY_L2

ROOT = Path(__file__).resolve().parents[3]
CANDIDATE_ROOT = ROOT / "phase2" / "candidates" / "candidate3"
CONTRACT_MANIFEST = CANDIDATE_ROOT / "FROZEN_CONTRACTS.json"
DEVELOPMENT = CANDIDATE_ROOT / "development_results.json"
HOLDOUT_META = CANDIDATE_ROOT / "holdout_public_metadata.json"
MODEL = ROOT / "src" / "phase2_candidate3_estimator" / "model.py"
INPUT = ROOT / "src" / "phase2_candidate3_estimator" / "input.py"
OUTPUT = CANDIDATE_ROOT / "FROZEN_IMPLEMENTATION.json"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _fingerprint(payload: object) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def main() -> None:
    contracts = json.loads(CONTRACT_MANIFEST.read_text(encoding="utf-8"))
    development = json.loads(DEVELOPMENT.read_text(encoding="utf-8"))
    holdout = json.loads(HOLDOUT_META.read_text(encoding="utf-8"))

    if contracts["status"] != "CONTRACTS_FROZEN_BEFORE_HOLDOUT_SEAL":
        raise RuntimeError("Candidate 3 contract state is not frozen")
    if holdout["status"] != "SEALED_AFTER_CONTRACT_FREEZE_BEFORE_ESTIMATOR_IMPLEMENTATION":
        raise RuntimeError("Candidate 3 holdout ordering is invalid")
    if holdout["contract_fingerprints"] != contracts["contract_fingerprints"]:
        raise RuntimeError("holdout is not bound to the frozen Candidate 3 contracts")
    if development["holdout_used_for_tuning"]:
        raise RuntimeError("Candidate 3 sealed holdout contaminated development")
    if development["candidate1_holdout_used"] or development["candidate2_holdout_used"]:
        raise RuntimeError("prior candidate holdout contamination detected")
    if development["frozen_phase1_used_for_tuning"]:
        raise RuntimeError("public falsification data contaminated development")
    if float(development["selected_propensity_l2"]) != 0.1 or PROPENSITY_L2 != 0.1:
        raise RuntimeError("selected propensity regularization does not match implementation")
    if BOOTSTRAP_REPLICATES != 400:
        raise RuntimeError("frozen uncertainty contract requires 400 bootstrap refits")

    selected = next(
        item
        for item in development["grid"]
        if float(item["propensity_l2"]) == 0.1
    )
    if int(selected["behavior_failures"]) != 0:
        raise RuntimeError("selected development configuration has behavior failures")
    if float(selected["abstention_calibration"]) != 1.0:
        raise RuntimeError("selected development abstention calibration is not perfect")
    if float(selected["estimate_decision_accuracy"]) != 1.0:
        raise RuntimeError("selected development estimate-decision accuracy is not perfect")
    if int(selected["ato_targeting_failures"]) != 0:
        raise RuntimeError("selected development configuration drifted toward ATE")

    code = {
        "model_sha256": _sha(MODEL),
        "input_sha256": _sha(INPUT),
    }
    hyperparameters = {
        "propensity_l2": PROPENSITY_L2,
        "bootstrap_replicates": BOOTSTRAP_REPLICATES,
        "estimator_family": "logistic propensity + overlap weighting",
    }
    lineage_payload = {
        "candidate_id": "candidate3-overlap-ato",
        "candidate_version": "1.0.0",
        "code": code,
        "contract_fingerprints": contracts["contract_fingerprints"],
        "development_results_sha256": _sha(DEVELOPMENT),
        "hyperparameters": hyperparameters,
        "holdout_version": holdout["version"],
        "holdout_generator_fingerprint": holdout["generator_fingerprint"],
        "holdout_configuration_fingerprint": holdout["configuration_fingerprint"],
    }
    payload = {
        **lineage_payload,
        "combined_code_fingerprint": _fingerprint(code),
        "lineage_fingerprint": _fingerprint(lineage_payload),
        "contract_manifest_sha256": _sha(CONTRACT_MANIFEST),
        "holdout_public_metadata_sha256": _sha(HOLDOUT_META),
        "full_population_ate_estimated": False,
        "status": "FROZEN_BEFORE_PUBLIC_FALSIFICATION",
    }
    OUTPUT.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print("CANDIDATE3_IMPLEMENTATION_FREEZE=" + json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from candidate3_holdout_evaluator import evaluate_holdout, load_private_instances


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-root", required=True)
    parser.add_argument("--seal", required=True)
    parser.add_argument("--scoring", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    candidate_root = Path(args.candidate_root)
    candidate_dir = candidate_root / "phase2" / "candidates" / "candidate3"
    frozen = json.loads(
        (candidate_dir / "FROZEN_IMPLEMENTATION.json").read_text(encoding="utf-8")
    )
    public = json.loads(
        (candidate_dir / "public_falsification_results.json").read_text(
            encoding="utf-8"
        )
    )
    if not bool(public["eligible_for_sealed_holdout"]):
        raise RuntimeError("Candidate 3 is not eligible for sealed holdout")

    model = candidate_root / "src" / "phase2_candidate3_estimator" / "model.py"
    input_file = candidate_root / "src" / "phase2_candidate3_estimator" / "input.py"
    if _sha(model) != frozen["code"]["model_sha256"]:
        raise RuntimeError("Candidate 3 model changed after freeze")
    if _sha(input_file) != frozen["code"]["input_sha256"]:
        raise RuntimeError("Candidate 3 input code changed after freeze")

    seal_payload = json.loads(Path(args.seal).read_text(encoding="utf-8"))
    if seal_payload["version"] != frozen["holdout_version"]:
        raise RuntimeError("private holdout version does not match frozen Candidate 3")
    if (
        seal_payload["configuration_fingerprint"]
        != frozen["holdout_configuration_fingerprint"]
    ):
        raise RuntimeError("private holdout configuration fingerprint mismatch")
    if (
        seal_payload["generator_fingerprint"]
        != frozen["holdout_generator_fingerprint"]
    ):
        raise RuntimeError("private holdout generator fingerprint mismatch")

    scoring = json.loads(Path(args.scoring).read_text(encoding="utf-8"))
    instances = load_private_instances(args.seal)
    result = evaluate_holdout(
        instances,
        lineage_fingerprint=str(frozen["lineage_fingerprint"]),
        scoring=scoring,
    )
    result.update(
        {
            "candidate_id": frozen["candidate_id"],
            "candidate_version": frozen["candidate_version"],
            "lineage_fingerprint": frozen["lineage_fingerprint"],
            "feedback_bearing_exposure_count": 1,
            "public_falsification_eligible": True,
            "full_population_ate_estimated": False,
        }
    )

    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        "CANDIDATE3_SEALED_HOLDOUT_RESULT="
        + json.dumps(
            {
                "outcome": result["outcome"],
                "criteria": result["criteria"],
                "design_failures": result["design_failures"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

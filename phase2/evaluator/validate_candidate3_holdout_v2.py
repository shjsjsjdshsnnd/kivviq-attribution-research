from __future__ import annotations

import argparse
import json
from pathlib import Path

from candidate3_holdout_evaluator import generate_holdout_case, load_private_instances
from candidate3_holdout_spec import HOLDOUT_VERSION

EXPECTED = {
    "adequate_overlap_recovery": "ESTIMATE_ATO",
    "weak_full_support_overlap_recovery": "ESTIMATE_ATO",
    "inadequate_overlap_abstention": "ABSTAIN_INADEQUATE_SUPPORT",
    "finite_sample_abstention": "ABSTAIN_INADEQUATE_FINITE_SAMPLE",
    "measurement_provenance_abstention": "ABSTAIN_PRETREATMENT_INVALID",
    "latent_confounding_non_goal": "ESTIMATE_ATO",
    "heterogeneous_overlap_effect": "ESTIMATE_ATO",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seal", required=True)
    parser.add_argument("--candidate-root", required=True)
    parser.add_argument("--metadata", required=True)
    args = parser.parse_args()

    state = json.loads(
        (
            Path(args.candidate_root)
            / "phase2/candidates/candidate3/holdout_exposure_state.json"
        ).read_text(encoding="utf-8")
    )
    if state["candidate_id"] != "candidate3-overlap-ato":
        raise RuntimeError("unexpected Candidate 3 identity")
    if state["candidate_version"] != "1.0.0":
        raise RuntimeError("unexpected Candidate 3 version")
    if state["holdout_version"] != "candidate3-holdout-v1":
        raise RuntimeError("Candidate 3 v1 exposure history changed")
    if int(state["feedback_bearing_exposure_count"]) != 1:
        raise RuntimeError("Candidate 3 v1 must already have exactly one feedback exposure")
    if state["state"] != "CONSUMED":
        raise RuntimeError("Candidate 3 v1 exposure must remain consumed")

    instances = load_private_instances(args.seal)
    generated = [generate_holdout_case(instance) for instance in instances]
    by_family = {case.family: case for case in generated}
    if set(by_family) != {
        "adequate_overlap_recovery",
        "weak_full_support_overlap_recovery",
        "inadequate_overlap_abstention",
        "finite_sample_abstention",
        "measurement_provenance_abstention",
        "latent_confounding_non_goal",
        "overlap_boundary",
        "heterogeneous_overlap_effect",
    }:
        raise RuntimeError("Candidate 3 v2 holdout family set changed")

    failures: list[str] = []
    for family, expected in EXPECTED.items():
        case = by_family[family]
        if not case.design_valid:
            failures.append(f"{family}: {case.design_reason}")
        if case.oracle_expected_decision != expected:
            failures.append(
                f"{family}: oracle={case.oracle_expected_decision}, expected={expected}"
            )

    boundary = by_family["overlap_boundary"]
    if not boundary.design_valid:
        failures.append(f"overlap_boundary: {boundary.design_reason}")
    if boundary.oracle_expected_decision is None:
        failures.append("overlap_boundary: missing oracle decision")

    if failures:
        raise RuntimeError("Candidate 3 v2 design validation failed: " + " | ".join(failures))

    metadata = json.loads(Path(args.metadata).read_text(encoding="utf-8"))
    if metadata["version"] != HOLDOUT_VERSION:
        raise RuntimeError("public metadata holdout version mismatch")
    if metadata["candidate3_v1_feedback_exposure_already_consumed"] is not True:
        raise RuntimeError("v1 exposure history missing from v2 metadata")
    if metadata["eligible_for_candidate3_v1_second_feedback_exposure"] is not False:
        raise RuntimeError("v2 must not authorize a second Candidate 3 v1 exposure")

    print(
        "CANDIDATE3_HOLDOUT_V2_DESIGN_VALID="
        + json.dumps(
            {
                "version": HOLDOUT_VERSION,
                "families_validated": len(generated),
                "candidate3_v1_feedback_exposure_count": 1,
                "candidate3_v1_second_feedback_exposure_allowed": False,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

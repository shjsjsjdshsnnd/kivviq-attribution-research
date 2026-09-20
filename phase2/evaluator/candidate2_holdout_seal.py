from __future__ import annotations

import argparse
import json
from pathlib import Path

from attribution_lab.phase2_evaluator.seals import HoldoutSealStore

HOLDOUT_VERSION = "candidate2-holdout-v1"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seal-dir", required=True)
    parser.add_argument("--metadata-out", required=True)
    args = parser.parse_args()

    seal_dir = Path(args.seal_dir)
    metadata_path = Path(args.metadata_out)
    if (Path("phase2") / "candidates" / "candidate2").exists():
        raise RuntimeError("Candidate 2 implementation exists before holdout sealing")
    if (Path("src") / "phase2_candidates" / "candidate2").exists():
        raise RuntimeError("Candidate 2 implementation exists before holdout sealing")
    if (Path("research") / "candidate2").exists():
        raise RuntimeError("Candidate 2 implementation exists before holdout sealing")

    store = HoldoutSealStore(seal_dir)
    metadata = store.create(HOLDOUT_VERSION)
    payload = metadata.as_dict()
    payload.update(
        {
            "status": "SEALED_BEFORE_CANDIDATE2_IMPLEMENTATION",
            "candidate_lineage": "candidate2",
            "candidate1_holdout_reused": False,
            "candidate1_holdout_version": "candidate1-holdout-v1",
            "candidate1_role": "historical evidence only; not a development target",
            "private_seal_committed_to_git": False,
        }
    )
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        "CANDIDATE2_HOLDOUT_SEALED="
        + json.dumps(
            {
                "version": payload["version"],
                "generator_fingerprint": payload["generator_fingerprint"],
                "configuration_fingerprint": payload["configuration_fingerprint"],
                "evaluation_protocol_version": payload["evaluation_protocol_version"],
                "creation_timestamp": payload["creation_timestamp"],
                "status": payload["status"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()

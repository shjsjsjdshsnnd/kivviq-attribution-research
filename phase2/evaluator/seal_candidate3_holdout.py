from __future__ import annotations

import argparse
import json
from pathlib import Path

from candidate3_holdout_spec import create_private_seal


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contracts", required=True)
    parser.add_argument("--seal-out", required=True)
    parser.add_argument("--metadata-out", required=True)
    args = parser.parse_args()

    if Path("phase2/candidates/candidate3/model.py").exists():
        raise RuntimeError("Candidate 3 estimator exists before holdout sealing")
    if Path("src/phase2_candidates/candidate3").exists():
        raise RuntimeError("Candidate 3 estimator package exists before holdout sealing")

    contracts = json.loads(Path(args.contracts).read_text(encoding="utf-8"))
    public = create_private_seal(Path(args.seal_out), frozen_contracts=contracts)
    Path(args.metadata_out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.metadata_out).write_text(
        json.dumps(public, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print("CANDIDATE3_HOLDOUT_SEALED=" + json.dumps(public, sort_keys=True))


if __name__ == "__main__":
    main()

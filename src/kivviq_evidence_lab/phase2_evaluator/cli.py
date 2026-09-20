from __future__ import annotations

import argparse
import json

from ..phase2.candidates.deterministic import DeterministicResolverCandidate
from .evaluator import evaluate_holdout
from .holdout_v1 import build_holdout_v1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kivviq-phase2-evaluator")
    parser.add_argument("candidate", choices=("deterministic",))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    suite = build_holdout_v1()
    if args.candidate == "deterministic":
        candidate = DeterministicResolverCandidate()
    else:
        return 2
    report = evaluate_holdout(candidate, suite)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True, default=str))
    else:
        for key, value in report.items():
            print(f"{key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

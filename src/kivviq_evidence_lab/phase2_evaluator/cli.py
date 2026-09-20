from __future__ import annotations

import argparse
import json

from ..phase2.candidates.anthropic_opus5 import AnthropicOpus5Backend, fixed_inference_settings
from ..phase2.candidates.candidate1 import CANDIDATE_VERSION, PROMPT_VERSION, Candidate1ModelResolver
from ..phase2.candidates.deterministic import DeterministicResolverCandidate
from .evaluator import evaluate_holdout
from .holdout_v1 import build_holdout_v1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kivviq-phase2-evaluator")
    parser.add_argument("candidate", choices=("deterministic", "candidate1"))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    suite = build_holdout_v1()
    metadata: dict[str, object] = {}
    if args.candidate == "deterministic":
        candidate = DeterministicResolverCandidate()
    elif args.candidate == "candidate1":
        backend = AnthropicOpus5Backend.from_env()
        candidate = Candidate1ModelResolver(backend)
        metadata = {
            "candidate_version": CANDIDATE_VERSION,
            "prompt_version": PROMPT_VERSION,
            "inference": fixed_inference_settings(),
        }
    else:
        return 2

    report = {**evaluate_holdout(candidate, suite), **metadata}
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True, default=str))
    else:
        for key, value in report.items():
            print(f"{key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

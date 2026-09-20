from __future__ import annotations

import argparse
import json

from .candidates.anthropic_opus5 import AnthropicOpus5Backend, fixed_inference_settings
from .candidates.candidate1 import CANDIDATE_VERSION, PROMPT_VERSION, Candidate1ModelResolver
from .dev_eval import evaluate_development


def manifest() -> dict[str, object]:
    return {
        "candidate_version": CANDIDATE_VERSION,
        "prompt_version": PROMPT_VERSION,
        "inference": fixed_inference_settings(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kivviq-candidate1")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("manifest")
    development = sub.add_parser("development")
    development.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    if args.command == "manifest":
        print(json.dumps(manifest(), indent=2, sort_keys=True))
        return 0

    if args.command == "development":
        backend = AnthropicOpus5Backend.from_env()
        candidate = Candidate1ModelResolver(backend)
        report = evaluate_development(candidate)
        report = {
            **report,
            "candidate_version": CANDIDATE_VERSION,
            "prompt_version": PROMPT_VERSION,
            "inference": fixed_inference_settings(),
        }
        if args.json:
            print(json.dumps(report, indent=2, sort_keys=True, default=str))
        else:
            for key, value in report.items():
                print(f"{key}: {value}")
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())

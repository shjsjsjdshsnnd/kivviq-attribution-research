from __future__ import annotations

import argparse
import json

from .candidates.deterministic import DeterministicResolverCandidate
from .dev_eval import evaluate_development
from .firewall import scan_candidate_isolation


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kivviq-phase2")
    sub = parser.add_subparsers(dest="command", required=True)
    dev = sub.add_parser("development")
    dev.add_argument("--json", action="store_true")
    firewall = sub.add_parser("firewall")
    firewall.add_argument("root", nargs="?", default=".")
    args = parser.parse_args(argv)

    if args.command == "development":
        report = evaluate_development(DeterministicResolverCandidate())
        print(json.dumps(report, indent=2, sort_keys=True, default=str))
        return 0
    if args.command == "firewall":
        findings = scan_candidate_isolation(args.root)
        if findings:
            for finding in findings:
                print(finding)
            return 1
        print("phase2 candidate isolation: pass")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

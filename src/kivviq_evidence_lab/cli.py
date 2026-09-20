from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from typing import cast

from .benchmark import CaseResult, run_benchmark
from .mutations import run_mutation_suite
from .safety import main as safety_main


def _serializable_benchmark() -> dict[str, object]:
    report = run_benchmark()
    results = cast(list[CaseResult], report.pop("results"))
    report["sample_failures"] = [asdict(r) for r in results if not r.passed][:20]
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kivviq-evidence-lab")
    sub = parser.add_subparsers(dest="command", required=True)
    bench = sub.add_parser("benchmark")
    bench.add_argument("--json", action="store_true")
    sub.add_parser("mutations")
    safe = sub.add_parser("safety")
    safe.add_argument("root", nargs="?", default=".")
    args = parser.parse_args(argv)

    if args.command == "benchmark":
        report = _serializable_benchmark()
        if args.json:
            print(json.dumps(report, indent=2, default=str, sort_keys=True))
        else:
            for key, value in report.items():
                print(f"{key}: {value}")
        return 0 if report["failed"] == 0 else 1
    if args.command == "mutations":
        report = run_mutation_suite()
        print(json.dumps(report, indent=2, default=str, sort_keys=True))
        return 0 if report["detected"] == report["total"] else 1
    if args.command == "safety":
        return safety_main([args.root])
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

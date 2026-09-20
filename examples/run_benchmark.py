from __future__ import annotations

import argparse

from attribution_lab.runner import run_benchmark, write_outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--output", default="benchmark_output")
    args = parser.parse_args()
    records = run_benchmark(quick=args.quick)
    write_outputs(records, args.output)
    print(f"wrote {len(records)} synthetic experiment-model records to {args.output}")


if __name__ == "__main__":
    main()

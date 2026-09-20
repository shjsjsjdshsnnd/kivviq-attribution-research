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
    experiments = len(
        {
            (
                record["spec"]["scenario"],
                record["spec"]["seed"],
                record["spec"]["sample_size"],
                record["spec"]["observation_quality"],
            )
            for record in records
        }
    )
    print(
        f"wrote {experiments} synthetic experiments and "
        f"{len(records)} model evaluations to {args.output}"
    )


if __name__ == "__main__":
    main()

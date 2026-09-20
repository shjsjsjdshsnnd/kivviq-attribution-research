from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from attribution_lab.phase2_evaluator.results import (
    REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
)
from research.candidate1.evaluate_preholdout import run as run_preholdout


def run() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[2]
    freeze = json.loads(
        (root / "candidate1" / "FROZEN.json").read_text(encoding="utf-8")
    )
    preholdout = run_preholdout()
    outcome = "READY_FOR_HOLDOUT" if preholdout["preholdout_gate_pass"] else "REJECT"
    return {
        "candidate_id": preholdout["candidate_id"],
        "candidate_version": preholdout["candidate_version"],
        "frozen_source_commit": freeze["frozen_source_commit"],
        "harness_reference": freeze["harness_reference"],
        "declaration_fingerprint": preholdout["declaration_fingerprint"],
        "development_record_fingerprint": preholdout["development_record_fingerprint"],
        "source_fingerprint": preholdout["source_fingerprint"],
        "phase1_reference": preholdout["phase1_reference"],
        "development_results": preholdout["development_results"],
        "frozen_phase1_results": preholdout["frozen_phase1_results"],
        "preregistered_phase1_checks": preholdout["preregistered_phase1_checks"],
        "preholdout_gate_pass": preholdout["preholdout_gate_pass"],
        "formal_preholdout_outcome": outcome,
        "sealed_holdout_status": (
            "NOT_RUN_CANDIDATE_REJECTED_BEFORE_HOLDOUT"
            if outcome == "REJECT"
            else "READY_FOR_ONE_FEEDBACK_BEARING_EVALUATION"
        ),
        "holdout_exposure_consumed": False,
        "holdout_limitation_disclosure": REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    }


def _markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# Candidate 1 frozen Phase 1 evaluation",
        "",
        f"- Candidate: {payload['candidate_id']} {payload['candidate_version']}",
        f"- Frozen source commit: {payload['frozen_source_commit']}",
        f"- Phase 1 reference: {payload['phase1_reference']}",
        f"- Pre-holdout gate: **{payload['formal_preholdout_outcome']}**",
        f"- Sealed holdout: **{payload['sealed_holdout_status']}**",
        f"- Holdout exposure consumed: **{payload['holdout_exposure_consumed']}**",
        "",
        "## Preregistered Phase 1 checks",
        "",
        "| Check | Pass | Detail |",
        "| --- | --- | --- |",
    ]
    checks = payload["preregistered_phase1_checks"]
    for name, check in sorted(checks.items()):
        details = ", ".join(
            f"{key}={value}"
            for key, value in check.items()
            if key != "pass"
        )
        lines.append(f"| {name} | {check['pass']} | {details} |")
    lines.extend(
        [
            "",
            "## Public holdout limitation",
            "",
            str(payload["holdout_limitation_disclosure"]),
            "",
            "This report is synthetic research only and makes no real-world causal claim.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    payload = run()
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    (output / "frozen_phase1.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output / "frozen_phase1.md").write_text(
        _markdown(payload),
        encoding="utf-8",
    )
    print(
        "Candidate 1 formal pre-holdout outcome: "
        + str(payload["formal_preholdout_outcome"])
    )


if __name__ == "__main__":
    main()

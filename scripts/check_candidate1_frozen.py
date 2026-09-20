from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "research" / "candidate1" / "FROZEN.json"


def main() -> int:
    payload = json.loads(MANIFEST.read_text(encoding="utf-8"))
    failures: list[str] = []
    for path, expected_blob in payload["files"].items():
        candidate_path = ROOT / path
        if not candidate_path.exists():
            failures.append(f"missing frozen Candidate 1 file: {path}")
            continue
        actual_blob = subprocess.run(
            ["git", "hash-object", str(candidate_path)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if actual_blob != expected_blob:
            failures.append(
                f"frozen Candidate 1 file changed: {path} "
                f"(expected {expected_blob}, got {actual_blob})"
            )
    if failures:
        print("Candidate 1 freeze verification failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print(
        "Candidate 1 freeze verification passed at source commit "
        + payload["frozen_source_commit"]
        + "."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

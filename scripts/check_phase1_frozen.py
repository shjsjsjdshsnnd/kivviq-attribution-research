from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "phase2" / "frozen_phase1_manifest.json"


def main() -> int:
    payload = json.loads(MANIFEST.read_text(encoding="utf-8"))
    failures: list[str] = []
    for path, expected_blob in payload["files"].items():
        file_path = ROOT / path
        if not file_path.exists():
            failures.append(f"missing frozen Phase 1 file: {path}")
            continue
        actual = subprocess.run(
            ["git", "hash-object", str(file_path)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if actual != expected_blob:
            failures.append(
                f"frozen Phase 1 file changed: {path} "
                f"(expected {expected_blob}, got {actual})"
            )

    if failures:
        print("Frozen Phase 1 verification failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print(
        "Frozen Phase 1 verification passed at "
        + payload["frozen_commit"]
        + "."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

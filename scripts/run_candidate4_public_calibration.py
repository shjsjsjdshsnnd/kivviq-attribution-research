from __future__ import annotations

import json
from pathlib import Path

from attribution_lab.phase2_calibration.candidate4_public import run_calibration


def main() -> None:
    records = run_calibration()
    destination = Path("phase2/studies/candidate4_public_support_calibration_surface.json")
    destination.write_text(json.dumps(records, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

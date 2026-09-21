from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path("phase2/candidates/candidate3")
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from public_falsification_worlds import public_falsification_cases  # noqa: E402


def test_public_falsification_suite_is_distinct_from_development() -> None:
    cases = public_falsification_cases()
    assert len(cases) == 14
    assert all(case.case_id.startswith("c3-pf-") for case in cases)
    assert not any("c3-dev-" in case.case_id for case in cases)


def test_public_suite_contains_estimation_and_all_abstention_modes() -> None:
    decisions = {case.expected_decision for case in public_falsification_cases()}
    assert decisions >= {
        "ESTIMATE_ATO",
        "ABSTAIN_INADEQUATE_SUPPORT",
        "ABSTAIN_INADEQUATE_FINITE_SAMPLE",
        "ABSTAIN_PRETREATMENT_INVALID",
    }


def test_public_suite_has_ato_vs_ate_targeting_cases() -> None:
    cases = public_falsification_cases()
    assert sum(case.ato_vs_ate_targeting_required for case in cases) == 4


def test_public_suite_uses_no_development_seeds() -> None:
    text = Path(
        "phase2/candidates/candidate3/public_falsification_worlds.py"
    ).read_text()
    for seed in (3301, 3302, 3303, 3304, 3305, 3306, 3307):
        assert str(seed) not in text

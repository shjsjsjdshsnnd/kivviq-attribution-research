from attribution_lab.phase2.constants import FROZEN_PHASE1_COMMIT
from attribution_lab.phase2.phase1_adapter import FrozenPhase1Adapter


def test_phase1_adapter_is_pinned_to_frozen_commit() -> None:
    assert (
        FROZEN_PHASE1_COMMIT
        == "1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf"
    )
    assert FrozenPhase1Adapter.reference == FROZEN_PHASE1_COMMIT


def test_phase1_adapter_labels_cases_as_frozen() -> None:
    case = FrozenPhase1Adapter.build_case(
        "balanced_multi_touch",
        seed=7,
        sample_size=20,
        observation_quality="perfect",
    )
    assert case.stage == "FROZEN_PHASE1"
    assert case.phase1_reference == FROZEN_PHASE1_COMMIT

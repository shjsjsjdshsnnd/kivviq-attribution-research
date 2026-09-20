from __future__ import annotations

import math
from pathlib import Path

from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2_evaluator.isolation import CandidateRunner, validate_candidate_source
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world
from phase2_candidate_sdk import DeclaredContext


SOURCE_PATH = Path("phase2/candidates/candidate1/candidate.py")


def _source() -> str:
    return SOURCE_PATH.read_text(encoding="utf-8")


def test_candidate_source_respects_evaluator_import_boundary() -> None:
    source = _source()
    validate_candidate_source(source)
    assert "attribution_lab" not in source
    assert "latent_intent" not in source
    assert "treatment_effects" not in source
    assert "selection_strength" not in source
    assert "oracle" not in source.lower()


def test_candidate_returns_finite_effects_and_intervals() -> None:
    world = generate_world(
        scenario_config("balanced_multi_touch", seed=2201, n_subjects=160)
    )
    response = CandidateRunner().execute(
        _source(),
        to_observable_dataset(world.dataset),
        DeclaredContext(
            stage="DEVELOPMENT",
            scenario_family="candidate1-test",
            estimand_fingerprint="candidate1-test-estimand",
        ),
    )
    estimates = dict(response.estimates)
    assert estimates
    assert response.uncertainty is not None
    lower = dict(response.uncertainty.lower)
    upper = dict(response.uncertainty.upper)
    assert set(estimates) == set(lower) == set(upper)
    for channel, value in estimates.items():
        assert math.isfinite(value)
        assert math.isfinite(lower[channel])
        assert math.isfinite(upper[channel])
        assert lower[channel] <= value <= upper[channel]

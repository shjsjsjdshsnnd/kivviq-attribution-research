from __future__ import annotations

import math
from pathlib import Path


SOURCE_PATH = Path("phase2/candidates/candidate1/candidate.py")


def _source() -> str:
    return SOURCE_PATH.read_text(encoding="utf-8")


def test_candidate_source_respects_evaluator_import_boundary() -> None:
    isolation = __import__("attribution_lab.phase2_evaluator.isolation", fromlist=["*"])
    source = _source()
    isolation.validate_candidate_source(source)
    assert "attribution_lab" not in source
    assert "latent_intent" not in source
    assert "treatment_effects" not in source
    assert "selection_strength" not in source
    assert "oracle" not in source.lower()


def test_candidate_returns_finite_effects_and_intervals() -> None:
    observable = __import__("attribution_lab.phase2.observable", fromlist=["*"])
    isolation = importlib.import_module("attribution_lab.phase2_evaluator.isolation")
    config = __import__("attribution_lab.simulation.config", fromlist=["*"])
    generator = __import__("attribution_lab.simulation.generator", fromlist=["*"])
    sdk = __import__("phase2_candidate_sdk", fromlist=["*"])

    world = generator.generate_world(
        config.scenario_config("balanced_multi_touch", seed=2201, n_subjects=160)
    )
    response = isolation.CandidateRunner().execute(
        _source(),
        observable.to_observable_dataset(world.dataset),
        sdk.DeclaredContext(
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

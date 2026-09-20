from __future__ import annotations

import json
from pathlib import Path

from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2_evaluator.isolation import CandidateRunner
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world
from phase2_candidate_sdk import DeclaredContext


def _response():
    source = Path("phase2/candidates/candidate2/model.py").read_text(encoding="utf-8")
    world = generate_world(
        scenario_config("balanced_multi_touch", seed=4202, n_subjects=180)
    )
    return CandidateRunner().execute(
        source,
        to_observable_dataset(world.dataset),
        DeclaredContext(
            stage="DEVELOPMENT",
            scenario_family="candidate2-unit-test",
            estimand_fingerprint="candidate2-preregistered-estimand",
        ),
    )


def test_candidate2_returns_signed_effects_uncertainty_and_overlap_diagnostics() -> None:
    response = _response()
    estimates = dict(response.estimates)
    assert estimates
    assert response.uncertainty is not None
    assert set(dict(response.uncertainty.lower)) == set(estimates)
    assert set(dict(response.uncertainty.upper)) == set(estimates)

    diagnostics = dict(response.diagnostics)
    overlap = json.loads(diagnostics["overlap_json"])
    assert set(overlap) == set(estimates)
    for values in overlap.values():
        assert 0.0 <= float(values["treatment_prevalence"]) <= 1.0
        assert 0.0 <= float(values["extreme_raw_propensity_fraction"]) <= 1.0
        assert float(values["treated_ess"]) > 0.0
        assert float(values["control_ess"]) > 0.0
        assert float(values["maximum_inverse_weight"]) >= 1.0


def test_candidate2_source_excludes_oracle_and_evaluator_features() -> None:
    source = Path("phase2/candidates/candidate2/model.py").read_text(encoding="utf-8")
    lowered = source.lower()
    assert "attribution_lab" not in source
    assert "oracle" not in lowered
    assert "holdout" not in lowered
    assert "latent_intent" not in lowered
    assert "selection_strength" not in lowered


def test_candidate2_is_deterministic_for_identical_observed_data() -> None:
    first = _response()
    second = _response()
    assert first == second

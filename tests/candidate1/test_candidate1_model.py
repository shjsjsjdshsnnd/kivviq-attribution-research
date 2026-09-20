from pathlib import Path

from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2_evaluator.isolation import CandidateRunner
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world
from phase2_candidate_sdk import DeclaredContext


def test_candidate1_returns_signed_effects_and_uncertainty() -> None:
    source = Path("phase2/candidates/candidate1/model.py").read_text(encoding="utf-8")
    world = generate_world(
        scenario_config("harmful_channel", seed=91, n_subjects=180)
    )
    response = CandidateRunner().execute(
        source,
        to_observable_dataset(world.dataset),
        DeclaredContext(
            stage="DEVELOPMENT",
            scenario_family="candidate1-unit-test",
            estimand_fingerprint="candidate1-preregistered-estimand",
        ),
    )
    estimates = dict(response.estimates)
    assert estimates
    assert response.uncertainty is not None
    assert set(dict(response.uncertainty.lower)) == set(estimates)
    assert set(dict(response.uncertainty.upper)) == set(estimates)


def test_candidate1_source_has_no_evaluator_or_oracle_imports() -> None:
    source = Path("phase2/candidates/candidate1/model.py").read_text(encoding="utf-8")
    assert "attribution_lab" not in source
    assert "oracle" not in source.lower()
    assert "holdout" not in source.lower()

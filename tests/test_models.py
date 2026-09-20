import pytest

from attribution_lab.models import (
    AttributionModel,
    FirstTouchModel,
    LastPaidTouchModel,
    LastTouchModel,
    LinearModel,
    MarkovRemovalModel,
    PositionBasedModel,
    ShapleyAttributionModel,
    TimeDecayModel,
)
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world


def _models() -> list[AttributionModel]:
    return [
        FirstTouchModel(),
        LastTouchModel(),
        LastPaidTouchModel(),
        LinearModel(),
        TimeDecayModel(),
        PositionBasedModel(),
        MarkovRemovalModel(),
        ShapleyAttributionModel(),
    ]


@pytest.mark.parametrize("model", _models(), ids=lambda model: model.name)
def test_models_are_deterministic_and_normalized(model: AttributionModel) -> None:
    world = generate_world(scenario_config("balanced_multi_touch", seed=19, n_subjects=220))
    first = model.attribute(world.dataset.journeys)
    second = model.attribute(world.dataset.journeys)

    assert first.channel_credit == second.channel_credit
    assert first.diagnostics == second.diagnostics
    normalized = first.total_credit == pytest.approx(1.0, abs=1e-12)
    empty = first.total_credit == pytest.approx(0.0, abs=1e-12)
    assert normalized or empty


@pytest.mark.parametrize("model", _models(), ids=lambda model: model.name)
def test_nonconverting_world_does_not_create_conversion_credit(
    model: AttributionModel,
) -> None:
    world = generate_world(scenario_config("balanced_multi_touch", seed=41, n_subjects=80))
    nonconverters = [
        journey for journey in world.dataset.journeys if journey.qualifying_conversion() is None
    ]
    result = model.attribute(nonconverters)
    assert result.total_credit == pytest.approx(0.0, abs=1e-12)


def test_markov_exposes_transition_support_diagnostics() -> None:
    world = generate_world(scenario_config("balanced_multi_touch", seed=5, n_subjects=100))
    diagnostics = MarkovRemovalModel().attribute(world.dataset.journeys).diagnostics
    assert diagnostics["unique_transitions"] >= 1
    assert 0.0 <= diagnostics["rare_transition_fraction"] <= 1.0


def test_shapley_exposes_coalition_support_diagnostics() -> None:
    world = generate_world(scenario_config("balanced_multi_touch", seed=5, n_subjects=100))
    diagnostics = ShapleyAttributionModel().attribute(world.dataset.journeys).diagnostics
    assert diagnostics["coalition_universe"] >= diagnostics["unique_path_sets"]
    assert 0.0 <= diagnostics["observed_set_support_ratio"] <= 1.0

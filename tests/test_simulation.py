from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world


def test_generator_is_reproducible() -> None:
    config = scenario_config("balanced_multi_touch", seed=101, n_subjects=60)
    first = generate_world(config)
    second = generate_world(config)
    assert first == second


def test_demand_capture_declares_brand_search_as_selection_not_treatment() -> None:
    config = scenario_config("demand_capture", seed=4, n_subjects=20)
    assert config.channel_log_odds_effect[Channel.GOOGLE_BRAND] == 0.0
    assert config.selection_strength[Channel.GOOGLE_BRAND] > 0.0


def test_null_paid_channel_has_zero_structural_effect() -> None:
    config = scenario_config("null_paid_channel", seed=4, n_subjects=20)
    assert config.channel_log_odds_effect[Channel.PINTEREST] == 0.0

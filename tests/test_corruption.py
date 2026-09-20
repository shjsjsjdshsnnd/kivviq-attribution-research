from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world
from attribution_lab.stress.corruption import CorruptionConfig, corrupt_world


def test_full_touch_loss_removes_observed_touches_not_truth() -> None:
    world = generate_world(scenario_config("balanced_multi_touch", seed=8, n_subjects=50))
    digest = world.manifest.digest
    corrupted = corrupt_world(
        world,
        CorruptionConfig(random_missing_touch_probability=1.0),
        seed=9,
    )
    assert all(not journey.ordered_touchpoints() for journey in corrupted.dataset.journeys)
    assert corrupted.manifest.digest == digest


def test_corruption_is_deterministic_given_seed() -> None:
    world = generate_world(scenario_config("balanced_multi_touch", seed=12, n_subjects=50))
    config = CorruptionConfig(
        random_missing_touch_probability=0.3,
        duplicate_event_probability=0.2,
        delayed_event_probability=0.2,
    )
    assert corrupt_world(world, config, seed=55) == corrupt_world(world, config, seed=55)

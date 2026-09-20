from datetime import UTC, datetime, timedelta

from attribution_lab.schemas.core import (
    AcquisitionEvidence,
    Channel,
    Conversion,
    Dataset,
    Journey,
    Session,
    Touchpoint,
)
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import SyntheticWorld, generate_world
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


def _manual_world() -> SyntheticWorld:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    sessions = tuple(
        Session(
            session_id=f"s-{index}",
            start=start + timedelta(days=index),
            end=start + timedelta(days=index, minutes=5),
            touchpoints=(
                Touchpoint(
                    event_id=f"e-{index}",
                    timestamp=start + timedelta(days=index),
                    channel=(Channel.META, Channel.EMAIL, Channel.DIRECT)[index],
                ),
            ),
        )
        for index in range(3)
    )
    journey = Journey(
        subject_id="subject",
        observation_start=start,
        observation_end=start + timedelta(days=7),
        sessions=sessions,
        conversion=Conversion("order", start + timedelta(days=4), 100.0),
        acquisition_evidence=AcquisitionEvidence.UNKNOWN,
    )
    manifest = generate_world(
        scenario_config("balanced_multi_touch", seed=3, n_subjects=1)
    ).manifest
    return SyntheticWorld(Dataset((journey,)), manifest)


def test_identity_fragmentation_actually_splits_observed_path() -> None:
    world = _manual_world()
    corrupted = corrupt_world(
        world,
        CorruptionConfig(identity_fragmentation_probability=1.0),
        seed=4,
    )
    assert len(corrupted.dataset.journeys) == 2
    assert all("fragment-" in journey.subject_id for journey in corrupted.dataset.journeys)
    assert sum(
        int(journey.qualifying_conversion() is not None)
        for journey in corrupted.dataset.journeys
    ) == 1
    assert corrupted.manifest is world.manifest


def test_observation_censoring_truncates_future_evidence_without_mutating_truth() -> None:
    world = _manual_world()
    digest = world.manifest.digest
    corrupted = corrupt_world(
        world,
        CorruptionConfig(censor_probability=1.0),
        seed=8,
    )
    observed = corrupted.dataset.journeys[0]
    assert observed.is_censored
    assert observed.observation_end < world.dataset.journeys[0].observation_end
    assert all(
        touch.timestamp < observed.observation_end
        for touch in observed.ordered_touchpoints()
    )
    assert corrupted.manifest.digest == digest

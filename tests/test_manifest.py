from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world
from attribution_lab.stress.corruption import CorruptionConfig, corrupt_world


def test_ground_truth_manifest_is_stable_under_observation_corruption() -> None:
    world = generate_world(scenario_config("demand_capture", seed=31, n_subjects=120))
    digest = world.manifest.digest
    payload = world.manifest.canonical_json()
    corrupted = corrupt_world(
        world,
        CorruptionConfig(
            random_missing_touch_probability=0.7,
            missing_purchase_probability=0.3,
            identity_fragmentation_probability=0.5,
            corrupted_utm_probability=0.8,
        ),
        seed=77,
    )

    assert corrupted.manifest is world.manifest
    assert corrupted.manifest.digest == digest
    assert corrupted.manifest.canonical_json() == payload
    assert corrupted.dataset != world.dataset


def test_manifest_contains_complete_declared_dgp_fields() -> None:
    manifest = generate_world(
        scenario_config("channel_interaction", seed=3, n_subjects=40)
    ).manifest
    payload = manifest.as_dict()

    assert payload["baseline_conversion_probability"] > 0
    assert payload["channel_treatment_effects"]
    assert payload["interaction_effects"]
    assert payload["outcome_generation_equation"]
    assert payload["random_seed"] == 3
    assert payload["simulator_parameters"]["n_subjects"] == 40
    assert "channel_exposure_probability" in payload["simulator_parameters"]
    assert "selection_strength" in payload["simulator_parameters"]
    assert "temporal_position" in payload["simulator_parameters"]
    assert "temporal_log_odds_effect" in payload["simulator_parameters"]
    assert "latent_intent_weight" in payload["simulator_parameters"]
    assert len(payload["derived_channel_incremental_effects"]) == 8

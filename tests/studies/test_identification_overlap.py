from __future__ import annotations

import json

from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.generator import generate_world
from attribution_lab.studies.identification_overlap.matrix import (
    StructuralCell,
    world_config,
)
from attribution_lab.studies.identification_overlap.runner import run_study
from attribution_lab.studies.identification_overlap.trace import generate_instrumented_world


def test_instrumented_generator_preserves_frozen_world_exactly() -> None:
    config = world_config(
        StructuralCell(1.25, 0.50, 0.85),
        sample_size=40,
        seed=17,
    )
    frozen = generate_world(config)
    instrumented = generate_instrumented_world(
        config,
        focal_channel=Channel.META,
    )
    assert instrumented.world == frozen
    assert len(instrumented.oracle_subjects) == config.n_subjects


def test_quick_study_has_required_axes_and_no_raw_oracle_subjects() -> None:
    payload = run_study(quick=True)
    assert payload["candidate_independent"] is True
    assert payload["candidate3_implemented"] is False
    assert payload["oracle_diagnostic_only"] is True
    assert payload["oracle_features_exported_to_candidate_interfaces"] is False
    assert payload["recoverability_map"]
    serialized = json.dumps(payload)
    assert "latent_intents" not in serialized
    assert "oracle_subjects" not in serialized
    assert "private_seed" not in serialized


def test_taxonomy_distinguishes_finite_sample_and_measurement_paths() -> None:
    payload = run_study(quick=True)
    labels = {item["primary_limitation"] for item in payload["recoverability_map"]}
    assert labels
    allowed = {
        "estimator_specification_limitation",
        "positivity_support_limitation",
        "observable_information_limitation",
        "finite_sample_limitation",
        "measurement_limitation",
        "structurally_non_identifiable",
        "no_dominant_limitation",
    }
    assert labels <= allowed

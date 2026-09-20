from __future__ import annotations

import json

import pytest

from attribution_lab.phase2.holdout_families import HoldoutFamily
from attribution_lab.phase2_evaluator.seals import (
    HoldoutSealStore,
    HoldoutVersionConflict,
)


def test_public_metadata_does_not_expose_hidden_parameters(tmp_path) -> None:
    store = HoldoutSealStore(tmp_path)
    metadata = store.create(
        "holdout-v1",
        seed=12345,
        created_at="2030-01-01T00:00:00+00:00",
    )
    public = json.dumps(metadata.as_dict(), sort_keys=True)
    assert "private_seed" not in public
    assert "12345" not in public
    assert "treatment_effects" not in public
    assert "selection_strength" not in public


def test_holdout_versions_are_immutable(tmp_path) -> None:
    store = HoldoutSealStore(tmp_path)
    store.create("holdout-v1", seed=1)
    with pytest.raises(HoldoutVersionConflict):
        store.create("holdout-v1", seed=2)
    store.create("holdout-v2", seed=2)


def test_holdout_families_cover_required_shift_types(tmp_path) -> None:
    store = HoldoutSealStore(tmp_path)
    store.create("holdout-v1", seed=9)
    families = {
        instance["family"]
        for instance in store.load_private_instances("holdout-v1")
    }
    assert families == {family.value for family in HoldoutFamily}

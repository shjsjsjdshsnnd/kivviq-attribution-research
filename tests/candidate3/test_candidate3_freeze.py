from __future__ import annotations

import json
from pathlib import Path

from phase2_candidate3_estimator.model import BOOTSTRAP_REPLICATES, PROPENSITY_L2

ROOT = Path("phase2/candidates/candidate3")


def test_selected_candidate3_hyperparameters_are_frozen() -> None:
    development = json.loads((ROOT / "development_results.json").read_text())
    assert development["selected_propensity_l2"] == 0.1
    assert PROPENSITY_L2 == 0.1
    assert BOOTSTRAP_REPLICATES == 400


def test_holdout_is_bound_to_same_contract_fingerprints() -> None:
    contracts = json.loads((ROOT / "FROZEN_CONTRACTS.json").read_text())
    holdout = json.loads((ROOT / "holdout_public_metadata.json").read_text())
    assert holdout["contract_fingerprints"] == contracts["contract_fingerprints"]
    assert holdout["version"] == "candidate3-holdout-v1"
    assert holdout["private_seed_exposed"] is False
    assert holdout["private_parameters_committed_to_git"] is False


def test_frozen_manifest_matches_sources_when_present() -> None:
    manifest = ROOT / "FROZEN_IMPLEMENTATION.json"
    if not manifest.exists():
        return
    payload = json.loads(manifest.read_text())
    assert payload["status"] == "FROZEN_BEFORE_PUBLIC_FALSIFICATION"
    assert payload["full_population_ate_estimated"] is False
    assert payload["hyperparameters"]["propensity_l2"] == 0.1
    assert payload["hyperparameters"]["bootstrap_replicates"] == 400

from __future__ import annotations

# ruff: noqa: I001

import json
import sys
from pathlib import Path

from attribution_lab.phase2.registration import CandidateRegistry

ROOT = Path("phase2/candidates/candidate2")
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from candidate_definition import build_declaration, build_development_record  # noqa: E402


def test_candidate2_selected_hyperparameters_match_development_record() -> None:
    development = json.loads((ROOT / "development_results.json").read_text())
    declaration = build_declaration()
    parameters = dict(declaration.hyperparameters)
    assert float(development["selected_outcome_l2"]) == float(parameters["outcome_l2"])
    assert float(development["selected_propensity_l2"]) == float(
        parameters["propensity_l2"]
    )
    assert development["candidate1_holdout_metrics_used_for_tuning"] is False
    assert development["candidate2_holdout_used_for_tuning"] is False
    assert development["frozen_phase1_used_for_tuning"] is False


def test_candidate2_frozen_fingerprints_match_source_when_manifest_exists(
    tmp_path,
) -> None:
    manifest_path = ROOT / "FROZEN.json"
    if not manifest_path.exists():
        return
    manifest = json.loads(manifest_path.read_text())
    source = (ROOT / "model.py").read_text()
    registered = CandidateRegistry(tmp_path).register(
        build_declaration(),
        source,
        build_development_record(),
        registered_at="2026-09-20T22:23:00+00:00",
    )
    assert registered.code_fingerprint == manifest["code_fingerprint"]
    assert registered.declaration_fingerprint == manifest["declaration_fingerprint"]
    assert (
        registered.development_record_fingerprint
        == manifest["development_record_fingerprint"]
    )
    assert registered.lineage_fingerprint == manifest["lineage_fingerprint"]


def test_candidate2_holdout_was_sealed_before_implementation() -> None:
    metadata = json.loads((ROOT / "holdout_public_metadata.json").read_text())
    assert metadata["version"] == "candidate2-holdout-v1"
    assert metadata["status"] == "SEALED_BEFORE_CANDIDATE2_IMPLEMENTATION"
    assert metadata["candidate1_holdout_reused"] is False

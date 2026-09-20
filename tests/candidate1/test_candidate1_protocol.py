from __future__ import annotations

import json
from pathlib import Path


PROTOCOL = Path("phase2/candidates/candidate1/frozen_protocol.json")
DEVELOPMENT = Path("phase2/candidates/candidate1/development_summary.json")


def test_frozen_protocol_is_development_derived_and_complete() -> None:
    protocol = json.loads(PROTOCOL.read_text(encoding="utf-8"))
    development = json.loads(DEVELOPMENT.read_text(encoding="utf-8"))

    assert protocol["candidate_id"] == "candidate1-stratified-lpm"
    assert protocol["version"] == "1.0.0"
    assert (
        protocol["parent_harness_commit"]
        == "3616d00c0855a0d3d9dcb8dbf578a3e68c26f9fa"
    )
    assert (
        protocol["candidate_source_blob_sha"]
        == development["source_blob_sha"]
    )
    assert development["label"] == "DEVELOPMENT"
    assert len(development["worlds"]) == 5

    worst = development["worst_development"]
    rules = protocol["falsification_criteria"]["family_rules"]
    mae_rules = [
        rule["threshold"]
        for rule in rules
        if rule["metric"] == "mean_absolute_error"
    ]
    max_rules = [
        rule["threshold"]
        for rule in rules
        if rule["metric"] == "max_absolute_error"
    ]
    assert min(mae_rules) > worst["mean_absolute_error"]
    assert min(max_rules) > worst["max_absolute_error"]
    assert len(protocol["falsification_criteria"]["required_holdout_families"]) == 8


def test_frozen_protocol_excludes_oracle_inputs() -> None:
    protocol = json.loads(PROTOCOL.read_text(encoding="utf-8"))
    hidden = set(protocol["intentionally_hidden_oracle_variables"])
    assert "true latent purchase intent" in hidden
    assert "true treatment effects" in hidden
    assert "holdout parameter values" in hidden
    assert "holdout seeds" in hidden
    assert "true latent purchase intent" not in protocol["required_observable_inputs"]

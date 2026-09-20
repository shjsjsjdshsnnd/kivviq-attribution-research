from __future__ import annotations

import pytest

from attribution_lab.phase2.development import DevelopmentWorldRecord
from attribution_lab.phase2.registration import CandidateRegistry, CandidateVersionConflict
from attribution_lab.phase2_evaluator.isolation import (
    CandidateRunner,
    ForbiddenCandidateImport,
)
from phase2_candidate_sdk import DeclaredContext, ObservableDataset


def test_deliberate_oracle_import_candidate_is_blocked() -> None:
    source = """
from attribution_lab.phase2_evaluator.holdout_dgp import OracleTruth
def estimate(dataset, context):
    return None
"""
    with pytest.raises(ForbiddenCandidateImport):
        CandidateRunner().execute(
            source,
            ObservableDataset(journeys=()),
            DeclaredContext(
                stage="SEALED_HOLDOUT",
                scenario_family="selection_shift",
                estimand_fingerprint="x",
                holdout_version="holdout-v1",
            ),
        )


def test_holdout_config_import_candidate_is_blocked() -> None:
    source = """
from attribution_lab.phase2_evaluator.seals import HoldoutSealStore
def estimate(dataset, context):
    return None
"""
    with pytest.raises(ForbiddenCandidateImport):
        CandidateRunner().execute(
            source,
            ObservableDataset(journeys=()),
            DeclaredContext(
                stage="SEALED_HOLDOUT",
                scenario_family="selection_shift",
                estimand_fingerprint="x",
                holdout_version="holdout-v1",
            ),
        )


def test_hyperparameter_mutation_requires_new_version(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    development = DevelopmentWorldRecord(
        candidate_id=declaration.candidate_id,
        candidate_version=declaration.version,
        world_ids=("dev",),
        parameter_ranges=(("x", "1..2"),),
        architecture_selection_notes="fixed",
        hyperparameter_selection_notes="fixed",
    )
    registry = CandidateRegistry(tmp_path)
    registry.register(declaration, valid_candidate_source, development)

    from dataclasses import replace

    changed = replace(
        declaration,
        hyperparameters=(("constant", "0.5"),),
    )
    with pytest.raises(CandidateVersionConflict):
        registry.register(changed, valid_candidate_source, development)

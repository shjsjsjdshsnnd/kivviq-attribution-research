from __future__ import annotations

from dataclasses import replace

import pytest

from attribution_lab.phase2.development import DevelopmentWorldRecord
from attribution_lab.phase2.registration import (
    CandidateRegistry,
    CandidateVersionConflict,
)


def _development(candidate_id: str, version: str) -> DevelopmentWorldRecord:
    return DevelopmentWorldRecord(
        candidate_id=candidate_id,
        candidate_version=version,
        world_ids=("dev-world-1",),
        parameter_ranges=(("latent_intent_weight", "0.2..1.2"),),
        architecture_selection_notes="used only development worlds",
        hyperparameter_selection_notes="fixed before frozen/holdout evaluation",
    )


def test_candidate_registration_is_immutable(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    registry = CandidateRegistry(tmp_path)
    development = _development(declaration.candidate_id, declaration.version)
    registry.register(declaration, valid_candidate_source, development)

    changed_source = valid_candidate_source + "\n# architecture mutation\n"
    with pytest.raises(CandidateVersionConflict):
        registry.register(declaration, changed_source, development)


def test_hyperparameter_mutation_requires_new_version(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    registry = CandidateRegistry(tmp_path)
    development = _development(declaration.candidate_id, declaration.version)
    registry.register(declaration, valid_candidate_source, development)
    changed = replace(declaration, hyperparameters=(("constant", "0.5"),))
    with pytest.raises(CandidateVersionConflict):
        registry.register(changed, valid_candidate_source, development)

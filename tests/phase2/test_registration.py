from __future__ import annotations

from dataclasses import replace

import pytest

from attribution_lab.phase2.development import DevelopmentWorldRecord
from attribution_lab.phase2.registration import (
    CandidateRegistry,
    CandidateVersionConflict,
    RepeatedHoldoutPeek,
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


def test_repeated_holdout_peeking_is_blocked(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    registry = CandidateRegistry(tmp_path)
    development = _development(declaration.candidate_id, declaration.version)
    registry.register(declaration, valid_candidate_source, development)
    registry.mark_holdout_exposure(declaration, valid_candidate_source, "holdout-v1")

    with pytest.raises(RepeatedHoldoutPeek):
        registry.mark_holdout_exposure(
            declaration,
            valid_candidate_source,
            "holdout-v1",
        )


def test_exact_reproducibility_rerun_is_recorded(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    registry = CandidateRegistry(tmp_path)
    development = _development(declaration.candidate_id, declaration.version)
    registry.register(declaration, valid_candidate_source, development)
    registry.mark_holdout_exposure(declaration, valid_candidate_source, "holdout-v1")
    registry.mark_holdout_exposure(
        declaration,
        valid_candidate_source,
        "holdout-v1",
        reproducibility_rerun=True,
    )
    payload = registry.read(declaration.candidate_id, declaration.version)
    assert len(payload["holdout_exposures"]) == 2


def test_post_exposure_code_mutation_is_blocked(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    registry = CandidateRegistry(tmp_path)
    development = _development(declaration.candidate_id, declaration.version)
    registry.register(declaration, valid_candidate_source, development)
    registry.mark_holdout_exposure(declaration, valid_candidate_source, "holdout-v1")

    with pytest.raises(CandidateVersionConflict):
        registry.mark_holdout_exposure(
            declaration,
            valid_candidate_source + "\n# changed architecture\n",
            "holdout-v1",
            reproducibility_rerun=True,
        )


def test_post_exposure_estimand_mutation_is_blocked(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    registry = CandidateRegistry(tmp_path)
    development = _development(declaration.candidate_id, declaration.version)
    registry.register(declaration, valid_candidate_source, development)
    registry.mark_holdout_exposure(declaration, valid_candidate_source, "holdout-v1")

    changed_estimand = replace(
        declaration.estimand,
        horizon_hours=declaration.estimand.horizon_hours + 24.0,
    )
    changed = replace(declaration, estimand=changed_estimand)
    with pytest.raises(CandidateVersionConflict):
        registry.mark_holdout_exposure(
            changed,
            valid_candidate_source,
            "holdout-v1",
            reproducibility_rerun=True,
        )


def test_post_exposure_success_criteria_mutation_is_blocked(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    registry = CandidateRegistry(tmp_path)
    development = _development(declaration.candidate_id, declaration.version)
    registry.register(declaration, valid_candidate_source, development)
    registry.mark_holdout_exposure(declaration, valid_candidate_source, "holdout-v1")

    first_rule = declaration.falsification_criteria.family_rules[0]
    changed_rule = replace(first_rule, threshold=first_rule.threshold + 0.1)
    changed_criteria = replace(
        declaration.falsification_criteria,
        family_rules=(changed_rule, *declaration.falsification_criteria.family_rules[1:]),
    )
    changed = replace(declaration, falsification_criteria=changed_criteria)
    with pytest.raises(CandidateVersionConflict):
        registry.mark_holdout_exposure(
            changed,
            valid_candidate_source,
            "holdout-v1",
            reproducibility_rerun=True,
        )

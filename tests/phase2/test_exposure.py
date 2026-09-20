from __future__ import annotations

from dataclasses import asdict, replace

import pytest

from attribution_lab.phase2.development import DevelopmentWorldRecord
from attribution_lab.phase2.holdout_families import HoldoutFamily
from attribution_lab.phase2.registration import CandidateRegistry, CandidateVersionConflict
from attribution_lab.phase2_evaluator.evaluator import HoldoutEvaluator
from attribution_lab.phase2_evaluator.exposure import (
    AuditReplayNotAllowed,
    HoldoutExposureConsumed,
)
from attribution_lab.phase2_evaluator.ledger import (
    HoldoutExposureEventType,
    ResearchLedger,
)
from attribution_lab.phase2_evaluator.seals import HoldoutSealStore


def _development(candidate_id: str, version: str) -> DevelopmentWorldRecord:
    return DevelopmentWorldRecord(
        candidate_id=candidate_id,
        candidate_version=version,
        world_ids=("dev-world-1",),
        parameter_ranges=(("observable_proxy_strength", "0.1..0.8"),),
        architecture_selection_notes="development only",
        hyperparameter_selection_notes="fixed before holdout",
    )


def _evaluator(tmp_path, declaration, source):
    registry = CandidateRegistry(tmp_path / "registrations")
    registry.register(
        declaration,
        source,
        _development(declaration.candidate_id, declaration.version),
    )
    seals = HoldoutSealStore(tmp_path / "seals")
    seals.create(
        "holdout-v1",
        seed=20260920,
        created_at="2030-01-01T00:00:00+00:00",
        families=(HoldoutFamily.SELECTION_SHIFT,),
    )
    ledger = ResearchLedger(tmp_path / "research-ledger.jsonl")
    return HoldoutEvaluator(seals, registry, ledger), registry, ledger


def test_first_feedback_evaluation_consumes_exposure(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    evaluator, _, ledger = _evaluator(tmp_path, declaration, valid_candidate_source)
    results = evaluator.evaluate(
        declaration,
        valid_candidate_source,
        holdout_version="holdout-v1",
    )
    assert results
    events = ledger.exposure_entries()
    assert [event.event_type for event in events] == [
        HoldoutExposureEventType.FEEDBACK_CONSUMED,
        HoldoutExposureEventType.FEEDBACK_RESULT,
    ]


def test_second_feedback_evaluation_is_blocked(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    evaluator, _, _ = _evaluator(tmp_path, declaration, valid_candidate_source)
    evaluator.evaluate(declaration, valid_candidate_source, holdout_version="holdout-v1")
    with pytest.raises(HoldoutExposureConsumed):
        evaluator.evaluate(
            declaration,
            valid_candidate_source,
            holdout_version="holdout-v1",
        )


def test_failed_candidate_cannot_tweak_and_rerun_same_version(
    tmp_path,
    declaration,
) -> None:
    failing_source = """
def estimate(dataset, context):
    raise RuntimeError("synthetic candidate failure")
"""
    evaluator, _, _ = _evaluator(tmp_path, declaration, failing_source)
    evaluator.evaluate(declaration, failing_source, holdout_version="holdout-v1")
    with pytest.raises(CandidateVersionConflict):
        evaluator.evaluate(
            declaration,
            failing_source + "\n# attempted tweak\n",
            holdout_version="holdout-v1",
        )


def test_candidate_renaming_alone_cannot_bypass_consumed_holdout(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    evaluator, registry, ledger = _evaluator(
        tmp_path,
        declaration,
        valid_candidate_source,
    )
    evaluator.evaluate(declaration, valid_candidate_source, holdout_version="holdout-v1")

    alias = replace(declaration, candidate_id="renamed-alias", version="99.0.0")
    registry.register(
        alias,
        valid_candidate_source,
        _development(alias.candidate_id, alias.version),
    )
    alias_evaluator = HoldoutEvaluator(
        evaluator.seal_store,
        registry,
        ledger,
    )
    with pytest.raises(HoldoutExposureConsumed):
        alias_evaluator.evaluate(
            alias,
            valid_candidate_source,
            holdout_version="holdout-v1",
        )


def test_audit_replay_requires_identical_frozen_candidate(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    evaluator, _, ledger = _evaluator(tmp_path, declaration, valid_candidate_source)
    evaluator.evaluate(declaration, valid_candidate_source, holdout_version="holdout-v1")
    receipt = evaluator.audit_replay(
        declaration,
        valid_candidate_source,
        holdout_version="holdout-v1",
    )
    assert asdict(receipt) == {
        "label": "AUDIT_REPLAY",
        "holdout_version": "holdout-v1",
        "evaluation_protocol_version": "phase2-evaluation-v1",
        "integrity_match": True,
    }
    assert ledger.exposure_entries()[-1].event_type == HoldoutExposureEventType.AUDIT_REPLAY

    with pytest.raises(CandidateVersionConflict):
        evaluator.audit_replay(
            declaration,
            valid_candidate_source + "\n# modified\n",
            holdout_version="holdout-v1",
        )


def test_audit_replay_cannot_precede_feedback_evaluation(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    evaluator, _, _ = _evaluator(tmp_path, declaration, valid_candidate_source)
    with pytest.raises(AuditReplayNotAllowed):
        evaluator.audit_replay(
            declaration,
            valid_candidate_source,
            holdout_version="holdout-v1",
        )


def test_exposure_survives_process_restart(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    evaluator, _, _ = _evaluator(tmp_path, declaration, valid_candidate_source)
    evaluator.evaluate(declaration, valid_candidate_source, holdout_version="holdout-v1")

    registry = CandidateRegistry(tmp_path / "registrations")
    seals = HoldoutSealStore(tmp_path / "seals")
    ledger = ResearchLedger(tmp_path / "research-ledger.jsonl")
    restarted = HoldoutEvaluator(seals, registry, ledger)
    with pytest.raises(HoldoutExposureConsumed):
        restarted.evaluate(
            declaration,
            valid_candidate_source,
            holdout_version="holdout-v1",
        )

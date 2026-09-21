from __future__ import annotations

import json
from dataclasses import asdict, replace
from pathlib import Path

import pytest

from attribution_lab.phase2.development import DevelopmentWorldRecord
from attribution_lab.phase2.holdout_families import HoldoutFamily
from attribution_lab.phase2.registration import (
    CandidateRegistry,
    CandidateVersionConflict,
    RegisteredCandidate,
)
from attribution_lab.phase2_evaluator.evaluator import HoldoutEvaluator
from attribution_lab.phase2_evaluator.exposure import (
    AuditReplayNotAllowed,
    EvaluationProhibitedPriorExposure,
    HoldoutExposureConsumed,
    HoldoutExposureController,
    RetrospectiveCandidateOutcomeUpgradeProhibited,
    assert_candidate3_outcome_not_retroactively_upgraded,
    assert_candidate3_v2_evaluation_permitted,
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


def test_candidate3_v1_lineage_is_prohibited_from_v2_even_when_renamed() -> None:
    with pytest.raises(
        EvaluationProhibitedPriorExposure,
        match="EVALUATION_PROHIBITED_PRIOR_EXPOSURE",
    ):
        assert_candidate3_v2_evaluation_permitted(
            candidate_id="candidate3-renamed",
            candidate_version="2.7.0",
            lineage_fingerprint="1571c29726e79154c2d9bc9016909ab7ab04540fe24cf63a62e0f46b66288620",
            combined_code_fingerprint="1a611d8777bc502ed4912b1fd98f7dae5009c834f3fa5e8a6dde5e0fdaac3522",
            contract_manifest_fingerprint="f760212ad3066bb266650fc0c7737f999a8f0c455d89f18a8c30526c2cbc983c",
            holdout_version="candidate3-holdout-v2",
        )


def test_candidate3_research_state_keeps_outcome_benchmark_and_evidence_separate() -> None:
    state_path = (
        Path(__file__).resolve().parents[2]
        / "phase2"
        / "evaluator"
        / "candidate3-research-state.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))

    assert state["candidate_level"] == {
        "outcome": "INCONCLUSIVE",
        "reason": "REQUIRED_HOLDOUT_BENCHMARK_INVALID",
        "retrospective_survive_from_family_evidence": "PROHIBITED",
    }
    assert state["benchmark_validity"] == {
        "candidate3-holdout-v1": "INVALID_FOR_COMPLETE_CANDIDATE3_GATE",
        "candidate3-holdout-v2": "VALIDATED_UNUSED",
    }
    assert state["family_level_evidence"]["candidate3-holdout-v1"] == {
        "aggregation_into_candidate_outcome": "PROHIBITED",
        "status": "IMMUTABLE_VALID_FAMILY_OBSERVATIONS",
    }


def test_candidate3_v2_prohibition_stops_feedback_before_ledger_mutation(
    tmp_path,
    declaration,
    valid_candidate_source,
) -> None:
    class FrozenCandidate3Registry:
        def validate_frozen(self, _declaration, _source) -> RegisteredCandidate:
            return RegisteredCandidate(
                candidate_id="renamed-candidate3",
                version="99.0.0",
                declaration_fingerprint="frozen-declaration",
                code_fingerprint="frozen-code",
                development_record_fingerprint="frozen-development",
                lineage_fingerprint="1571c29726e79154c2d9bc9016909ab7ab04540fe24cf63a62e0f46b66288620",
                registered_at="2030-01-01T00:00:00+00:00",
            )

    ledger = ResearchLedger(tmp_path / "research-ledger.jsonl")
    controller = HoldoutExposureController(FrozenCandidate3Registry(), ledger)
    with pytest.raises(
        EvaluationProhibitedPriorExposure,
        match="EVALUATION_PROHIBITED_PRIOR_EXPOSURE",
    ):
        controller.consume_feedback(
            declaration,
            valid_candidate_source,
            "candidate3-holdout-v2",
        )
    assert ledger.exposure_entries() == ()


def test_candidate3_family_evidence_cannot_upgrade_candidate_outcome() -> None:
    with pytest.raises(RetrospectiveCandidateOutcomeUpgradeProhibited):
        assert_candidate3_outcome_not_retroactively_upgraded("SURVIVE")

from __future__ import annotations

import json

import pytest

from attribution_lab.phase2_evaluator.ledger import (
    EvaluationLedgerEntry,
    LedgerIntegrityError,
    ResearchLedger,
)


def _entry(outcome: str) -> EvaluationLedgerEntry:
    return EvaluationLedgerEntry(
        candidate_id="mock",
        candidate_version="1.0.0",
        estimand_declaration_fingerprint="estimand",
        hypothesis_fingerprint="hypothesis",
        candidate_code_fingerprint="code",
        development_world_record_fingerprint="development",
        phase1_reference="frozen",
        holdout_version="holdout-v1",
        evaluation_timestamp="2030-01-01T00:00:00+00:00",
        evaluation_protocol_version="phase2-evaluation-v1",
        results=(("selection_shift", "evaluated"),),
        uncertainty=(("method", "mock"),),
        robustness_results=(("repeated_seed", "pass"),),
        outcome=outcome,
        rejection_reasons=(),
    )


def test_research_ledger_is_append_only_and_verifiable(tmp_path) -> None:
    ledger = ResearchLedger(tmp_path / "ledger.jsonl")
    first = ledger.append(_entry("SURVIVE"))
    second = ledger.append(_entry("REJECT"))
    assert first != second
    ledger.verify()


def test_ledger_detects_tampering(tmp_path) -> None:
    path = tmp_path / "ledger.jsonl"
    ledger = ResearchLedger(path)
    ledger.append(_entry("SURVIVE"))
    records = [json.loads(line) for line in path.read_text().splitlines()]
    records[0]["entry"]["outcome"] = "REJECT"
    path.write_text(json.dumps(records[0]) + "\n")
    with pytest.raises(LedgerIntegrityError):
        ledger.verify()

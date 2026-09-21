from __future__ import annotations

import json
from pathlib import Path


def _registration() -> dict[str, object]:
    path = Path(__file__).resolve().parents[2] / "phase2/candidate4/PREREGISTRATION.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_candidate4_preregistration_has_distinct_actions_and_no_implementation() -> None:
    registration = _registration()
    assert registration["status"] == "PREREGISTERED_NO_IMPLEMENTATION_NO_HOLDOUT"
    assert set(registration["actions"]) == {"ATE", "ATO", "ABSTAIN"}
    assert registration["holdout_assignment"] == "NONE; candidate3-holdout-v2 remains VALIDATED_UNUSED_AND_UNASSIGNED"


def test_candidate4_contract_prohibits_leakage_and_requires_temporal_provenance() -> None:
    registration = _registration()
    assert registration["xt_contract"]["required"] == "source_event_time < decision_time"
    assert "outcome_information" in registration["xt_contract"]["prohibited"]
    assert "true_ate" in registration["policy_inputs"]["prohibited_oracle"]
    assert registration["evaluator_truth"]["basis"] == "STRUCTURAL_IDENTIFICATION_AND_SUPPORT_RULES_NOT_ESTIMATOR_ERROR"


def test_candidate4_evaluation_cannot_be_rescued_by_estimate_quality_or_always_abstain() -> None:
    registration = _registration()
    evaluation = registration["evaluation"]
    assert evaluation["estimation_is_downstream"] is True
    assert evaluation["always_action_policies_pass"] is False
    assert evaluation["severity"]["ABSTAIN_TO_ATE"] == "CRITICAL_OVERCLAIM"

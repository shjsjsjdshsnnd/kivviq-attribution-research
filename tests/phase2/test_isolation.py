from __future__ import annotations

import json

import pytest

from attribution_lab.phase2_evaluator.isolation import (
    CandidateExecutionError,
    CandidateRunner,
    ForbiddenCandidateImport,
    validate_candidate_source,
)
from phase2_candidate_sdk import DeclaredContext, ObservableDataset


@pytest.mark.parametrize(
    "source",
    [
        "from attribution_lab.phase2_evaluator.seals import HoldoutSealStore",
        "from attribution_lab.phase2_evaluator.holdout_dgp import OracleTruth",
        "import attribution_lab.phase2_evaluator",
        'import importlib\nimportlib.import_module("attribution_lab.phase2_evaluator.seals")',
        '__import__("attribution_lab.phase2_evaluator")',
    ],
)
def test_forbidden_evaluator_imports_fail_validation(source: str) -> None:
    with pytest.raises(ForbiddenCandidateImport):
        validate_candidate_source(source)


def test_candidate_request_contains_no_oracle_seed_or_manifest(
    valid_candidate_source,
) -> None:
    runner = CandidateRunner()
    dataset = ObservableDataset(journeys=())
    context = DeclaredContext(
        stage="SEALED_HOLDOUT",
        scenario_family="selection_shift",
        estimand_fingerprint="estimand-fingerprint",
        phase1_reference="frozen-reference",
        holdout_version="holdout-v1",
    )
    response = runner.execute(valid_candidate_source, dataset, context)
    assert response.estimates
    assert runner.last_workspace is not None
    assert not runner.last_workspace.exists()

    serialized = json.dumps(context.as_dict(), sort_keys=True).lower()
    for forbidden in ("oracle", "private_seed", "treatment_effect", "selection_strength"):
        assert forbidden not in serialized


def test_candidate_exception_is_sanitized() -> None:
    source = """
def estimate(dataset, context):
    raise RuntimeError("attempted internal detail leak")
"""
    runner = CandidateRunner()
    with pytest.raises(CandidateExecutionError) as exc:
        runner.execute(
            source,
            ObservableDataset(journeys=()),
            DeclaredContext(
                stage="SEALED_HOLDOUT",
                scenario_family="selection_shift",
                estimand_fingerprint="x",
                holdout_version="holdout-v1",
            ),
        )
    assert str(exc.value) == "candidate execution failed"
    assert "internal detail" not in str(exc.value)

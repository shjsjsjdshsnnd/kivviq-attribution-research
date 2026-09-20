from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from attribution_lab.phase2_evaluator.isolation import CandidateRunner, validate_candidate_source
from phase2_candidate_sdk import DeclaredContext, fingerprint_payload
from research.candidate1.development_worlds import development_worlds
from research.candidate1.preregistration import DECLARATION


def _source() -> str:
    return Path("research/candidate1/candidate.py").read_text(encoding="utf-8")


def test_candidate_source_respects_isolation_contract() -> None:
    source = _source()
    validate_candidate_source(source)
    forbidden = (
        "latent_intent",
        "oracle",
        "phase2_evaluator",
        "holdout_dgp",
        "selection_strength",
        "treatment_effects",
    )
    lowered = source.lower()
    assert all(term not in lowered for term in forbidden)


def test_candidate_is_deterministic_on_development_world() -> None:
    world = development_worlds()[0]
    context = DeclaredContext(
        stage="DEVELOPMENT",
        scenario_family=world.world_id,
        estimand_fingerprint=fingerprint_payload(asdict(DECLARATION.estimand)),
    )
    runner = CandidateRunner()
    first = runner.execute(_source(), world.dataset, context)
    second = runner.execute(_source(), world.dataset, context)
    assert first == second
    assert first.uncertainty is not None
    assert dict(first.estimates)


def test_candidate_can_return_signed_effects() -> None:
    world = development_worlds()[0]
    context = DeclaredContext(
        stage="DEVELOPMENT",
        scenario_family=world.world_id,
        estimand_fingerprint=fingerprint_payload(asdict(DECLARATION.estimand)),
    )
    response = CandidateRunner().execute(_source(), world.dataset, context)
    estimates = dict(response.estimates)
    assert estimates["channel_a"] > 0.0
    assert estimates["channel_b"] < 0.0

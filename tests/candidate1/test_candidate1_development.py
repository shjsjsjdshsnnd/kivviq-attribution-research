from pathlib import Path

from attribution_lab.phase2_evaluator.isolation import validate_candidate_source
from phase2_candidates.candidate1.development import development_configs, source_for
from phase2_candidates.candidate1.protocol import declaration


def test_candidate1_source_respects_candidate_import_boundary() -> None:
    validate_candidate_source(
        Path("src/phase2_candidates/candidate1/candidate.py").read_text(encoding="utf-8")
    )


def test_candidate1_estimand_is_incremental_and_signed() -> None:
    declared = declaration(
        propensity_l2=0.1,
        propensity_clip=0.05,
        bootstrap_reps=100,
    )
    assert declared.estimand.kind.value == "incremental_conversion_probability"
    assert declared.negative_effects_representable
    assert not declared.interactions_representable


def test_candidate1_development_worlds_are_explicit_and_not_holdouts() -> None:
    names = {config.scenario_name for config in development_configs()}
    assert len(names) == 5
    assert all(name.startswith("candidate1-dev-") for name in names)


def test_development_source_substitution_is_limited_to_preregistered_knobs() -> None:
    source = source_for(0.5, 0.1, bootstrap_reps=100)
    assert "PROPENSITY_L2 = 0.50" in source
    assert "PROPENSITY_CLIP = 0.10" in source
    assert "BOOTSTRAP_REPS = 100" in source
    assert "GRADIENT_STEPS = 300" in source
    assert "LEARNING_RATE = 0.05" in source

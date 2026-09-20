import json

from attribution_lab.runner import (
    FULL_SCENARIOS,
    MODEL_NAMES,
    OBSERVATION_QUALITIES,
    RESEARCH_SAMPLE_SIZES,
    RESEARCH_SEEDS,
    ExperimentSpec,
    full_benchmark_specs,
    model_factories,
    run_specs,
    write_outputs,
)


def test_model_registry_is_frozen_to_eight_phase1_baselines() -> None:
    assert tuple(model_factories()) == MODEL_NAMES
    assert len(MODEL_NAMES) == 8


def test_full_benchmark_matrix_dimensions() -> None:
    specs = full_benchmark_specs()
    expected = (
        len(FULL_SCENARIOS)
        * len(RESEARCH_SEEDS)
        * len(RESEARCH_SAMPLE_SIZES)
        * len(OBSERVATION_QUALITIES)
    )
    assert len(specs) == expected
    assert set(OBSERVATION_QUALITIES) >= {
        "perfect",
        "missing_10",
        "missing_25",
        "missing_50",
        "channel_specific_missing",
        "fragmented_identity",
        "missing_click_ids",
        "utm_corruption",
        "utm_removal",
        "cookie_loss",
        "session_splitting",
        "delayed_events",
        "duplicated_events",
        "consent_exclusions",
        "observation_censoring",
    }


def test_runner_executes_all_eight_baselines_and_writes_analysis(tmp_path) -> None:
    specs = [
        ExperimentSpec("balanced_multi_touch", 5, 80, "perfect"),
        ExperimentSpec("balanced_multi_touch", 5, 80, "missing_10"),
    ]
    records = run_specs(specs)
    assert len(records) == 16
    assert {record["model"] for record in records} == set(model_factories())
    assert len({record["manifest_digest"] for record in records}) == 1

    write_outputs(records, str(tmp_path))
    matrix = json.loads((tmp_path / "matrix.json").read_text())
    assert matrix["synthetic_experiments"] == 2
    assert matrix["model_evaluations"] == 16
    assert (tmp_path / "phase1_research_report.md").exists()
    assert (tmp_path / "failure_modes.json").exists()
    assert (tmp_path / "uncertainty.json").exists()
    assert (tmp_path / "simulator_bias_audit.json").exists()

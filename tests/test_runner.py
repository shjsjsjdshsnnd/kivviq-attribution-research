import json

from attribution_lab.runner import (
    ExperimentSpec,
    model_factories,
    run_experiment,
    write_outputs,
)


def test_runner_executes_all_eight_baselines_and_persists_truth(tmp_path) -> None:
    records = run_experiment(
        ExperimentSpec(
            scenario="balanced_multi_touch",
            seed=5,
            sample_size=80,
            observation_quality="missing_10",
        )
    )
    assert len(records) == 8
    assert {record["model"] for record in records} == set(model_factories())
    assert len({record["manifest_digest"] for record in records}) == 1

    write_outputs(records, tmp_path)
    manifests = json.loads((tmp_path / "ground_truth_manifests.json").read_text())
    assert len(manifests) == 1

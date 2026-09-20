from pathlib import Path


def test_simulation_layer_does_not_import_attribution_models() -> None:
    simulation_root = Path("src/attribution_lab/simulation")
    combined = "\n".join(
        path.read_text(encoding="utf-8")
        for path in simulation_root.rglob("*.py")
    )
    assert "attribution_lab.models" not in combined


def test_corruption_layer_does_not_branch_on_model_name() -> None:
    content = Path("src/attribution_lab/stress/corruption.py").read_text(encoding="utf-8")
    for model_name in (
        "first_touch",
        "last_touch",
        "last_paid_touch",
        "linear",
        "time_decay",
        "position_based",
        "markov_removal",
        "shapley",
    ):
        assert model_name not in content

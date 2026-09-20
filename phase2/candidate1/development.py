from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.phase2_evaluator.evaluator import evaluate_known_case
from attribution_lab.phase2_evaluator.results import EvaluationStage
from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.config import WorldConfig
from attribution_lab.simulation.generator import generate_world

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "phase2" / "candidate1" / "candidate.py").read_text(encoding="utf-8")


def _load_spec() -> ModuleType:
    path = ROOT / "phase2" / "candidate1" / "spec.py"
    module_spec = importlib.util.spec_from_file_location("candidate1_spec", path)
    if module_spec is None or module_spec.loader is None:
        raise RuntimeError("unable to load Candidate 1 spec")
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module


DECLARATION = _load_spec().DECLARATION


def _base_exposure() -> dict[Channel, float]:
    channels = list(Channel)
    values = (0.38, 0.31, 0.26, 0.22, 0.34, 0.29, 0.41, 0.18)
    return dict(zip(channels, values, strict=True))


def _worlds() -> tuple[WorldConfig, ...]:
    channels = list(Channel)
    exposure = _base_exposure()
    return (
        WorldConfig(
            scenario_name="candidate1-dev-balanced-v1",
            n_subjects=500,
            seed=1101,
            baseline_conversion_probability=0.06,
            channel_exposure_probability=exposure,
            channel_log_odds_effect={
                channels[0]: 0.35,
                channels[1]: 0.25,
                channels[2]: 0.15,
                channels[3]: 0.00,
                channels[4]: 0.30,
                channels[5]: 0.05,
                channels[6]: 0.00,
                channels[7]: 0.18,
            },
            latent_intent_weight=0.35,
            max_touchpoints=5,
        ),
        WorldConfig(
            scenario_name="candidate1-dev-selection-v1",
            n_subjects=700,
            seed=1102,
            baseline_conversion_probability=0.04,
            channel_exposure_probability=exposure,
            channel_log_odds_effect={
                channels[0]: 0.00,
                channels[1]: 0.55,
                channels[2]: 0.25,
                channels[3]: 0.00,
            },
            selection_strength={
                channels[0]: 1.60,
                channels[3]: 0.90,
            },
            latent_intent_weight=1.35,
            max_touchpoints=5,
        ),
        WorldConfig(
            scenario_name="candidate1-dev-negative-v1",
            n_subjects=350,
            seed=1103,
            baseline_conversion_probability=0.09,
            channel_exposure_probability=exposure,
            channel_log_odds_effect={
                channels[0]: -0.70,
                channels[1]: 0.45,
                channels[2]: 0.20,
                channels[3]: 0.00,
            },
            latent_intent_weight=0.55,
            max_touchpoints=4,
        ),
    )


def main() -> None:
    records = []
    for config in _worlds():
        world = generate_world(config)
        result = evaluate_known_case(
            DECLARATION,
            SOURCE,
            dataset=to_observable_dataset(world.dataset),
            synthetic_truth=tuple(
                sorted(
                    (channel.value, value)
                    for channel, value in world.manifest.incremental_effect_map().items()
                )
            ),
            stage=EvaluationStage.DEVELOPMENT,
            family=config.scenario_name,
        )
        records.append(
            {
                "stage": result.stage.value,
                "world": config.scenario_name,
                "status": result.status.value,
                "metrics": dict(result.metrics),
                "uncertainty_present": result.uncertainty_present,
            }
        )
    print(json.dumps(records, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

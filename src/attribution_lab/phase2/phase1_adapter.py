from __future__ import annotations

from dataclasses import dataclass

from attribution_lab.phase2.constants import FROZEN_PHASE1_COMMIT
from attribution_lab.phase2.observable import to_observable_dataset
from attribution_lab.runner import corruption_for_quality
from attribution_lab.simulation.config import scenario_config
from attribution_lab.simulation.generator import generate_world
from attribution_lab.stress.corruption import corrupt_world
from phase2_candidate_sdk import ObservableDataset


@dataclass(frozen=True, slots=True)
class FrozenPhase1Case:
    scenario: str
    seed: int
    sample_size: int
    observation_quality: str
    observable_dataset: ObservableDataset
    synthetic_truth: tuple[tuple[str, float], ...]
    manifest_digest: str
    stage: str = "FROZEN_PHASE1"
    phase1_reference: str = FROZEN_PHASE1_COMMIT


class FrozenPhase1Adapter:
    reference = FROZEN_PHASE1_COMMIT

    @staticmethod
    def build_case(
        scenario: str,
        *,
        seed: int,
        sample_size: int,
        observation_quality: str,
    ) -> FrozenPhase1Case:
        pristine = generate_world(
            scenario_config(scenario, seed=seed, n_subjects=sample_size)
        )
        observed = corrupt_world(
            pristine,
            corruption_for_quality(observation_quality),
            seed=seed + 100_000,
        )
        return FrozenPhase1Case(
            scenario=scenario,
            seed=seed,
            sample_size=sample_size,
            observation_quality=observation_quality,
            observable_dataset=to_observable_dataset(observed.dataset),
            synthetic_truth=tuple(
                sorted(
                    (channel.value, value)
                    for channel, value in pristine.manifest.incremental_effect_map().items()
                )
            ),
            manifest_digest=pristine.manifest.digest,
        )

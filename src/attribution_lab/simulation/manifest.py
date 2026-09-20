from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.config import WorldConfig


def _string_map(mapping: Mapping[Channel, float]) -> dict[str, float]:
    return {channel.value: float(value) for channel, value in mapping.items()}


def _config_dict(config: WorldConfig) -> dict[str, Any]:
    return {
        "scenario_name": config.scenario_name,
        "n_subjects": config.n_subjects,
        "seed": config.seed,
        "baseline_conversion_probability": config.baseline_conversion_probability,
        "channel_exposure_probability": _string_map(config.channel_exposure_probability),
        "channel_log_odds_effect": _string_map(config.channel_log_odds_effect),
        "interaction_log_odds_effect": {
            "+".join(channel.value for channel in channels): float(value)
            for channels, value in config.interaction_log_odds_effect.items()
        },
        "selection_strength": _string_map(config.selection_strength),
        "temporal_position": _string_map(config.temporal_position),
        "temporal_log_odds_effect": dict(config.temporal_log_odds_effect),
        "latent_intent_weight": config.latent_intent_weight,
        "max_touchpoints": config.max_touchpoints,
        "observation_hours": config.observation_hours,
        "order_value_mean": config.order_value_mean,
        "order_value_std": config.order_value_std,
        "returning_session_probability": config.returning_session_probability,
        "consent_granted_probability": config.consent_granted_probability,
    }


@dataclass(frozen=True, slots=True)
class GroundTruthManifest:
    schema_version: str
    scenario_name: str
    baseline_conversion_probability: float
    channel_treatment_effects: tuple[tuple[str, float], ...]
    interaction_effects: tuple[tuple[str, float], ...]
    exposure_selection_mechanisms: tuple[tuple[str, float], ...]
    temporal_effects: tuple[tuple[str, float], ...]
    latent_variables: tuple[tuple[str, str], ...]
    outcome_generation_equation: str
    random_seed: int
    simulator_parameters_json: str
    derived_channel_incremental_effects: tuple[tuple[str, float], ...]

    @classmethod
    def from_config(
        cls,
        config: WorldConfig,
        derived_channel_incremental_effects: Mapping[Channel, float],
    ) -> GroundTruthManifest:
        return cls(
            schema_version="1.0",
            scenario_name=config.scenario_name,
            baseline_conversion_probability=config.baseline_conversion_probability,
            channel_treatment_effects=tuple(
                sorted(_string_map(config.channel_log_odds_effect).items())
            ),
            interaction_effects=tuple(
                sorted(
                    (
                        "+".join(channel.value for channel in channels),
                        float(value),
                    )
                    for channels, value in config.interaction_log_odds_effect.items()
                )
            ),
            exposure_selection_mechanisms=tuple(
                sorted(_string_map(config.selection_strength).items())
            ),
            temporal_effects=tuple(sorted(config.temporal_log_odds_effect.items())),
            latent_variables=(
                ("intent", "Normal(0,1)"),
                ("intent_weight", str(config.latent_intent_weight)),
            ),
            outcome_generation_equation=(
                "Bernoulli(sigmoid(logit(baseline) + intent_weight*intent + "
                "sum(channel_log_odds_effect) + sum(interaction_log_odds_effect) + "
                "sum(applicable_temporal_log_odds_effect)))"
            ),
            random_seed=config.seed,
            simulator_parameters_json=json.dumps(
                _config_dict(config),
                sort_keys=True,
                separators=(",", ":"),
            ),
            derived_channel_incremental_effects=tuple(
                sorted(
                    (channel.value, float(effect))
                    for channel, effect in derived_channel_incremental_effects.items()
                )
            ),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "scenario_name": self.scenario_name,
            "baseline_conversion_probability": self.baseline_conversion_probability,
            "channel_treatment_effects": dict(self.channel_treatment_effects),
            "interaction_effects": dict(self.interaction_effects),
            "exposure_selection_mechanisms": dict(self.exposure_selection_mechanisms),
            "temporal_effects": dict(self.temporal_effects),
            "latent_variables": dict(self.latent_variables),
            "outcome_generation_equation": self.outcome_generation_equation,
            "random_seed": self.random_seed,
            "simulator_parameters": json.loads(self.simulator_parameters_json),
            "derived_channel_incremental_effects": dict(
                self.derived_channel_incremental_effects
            ),
        }

    def canonical_json(self) -> str:
        return json.dumps(self.as_dict(), sort_keys=True, separators=(",", ":"))

    @property
    def digest(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()

    def save(self, path: str | Path) -> None:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(self.as_dict(), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def incremental_effect_map(self) -> dict[Channel, float]:
        return {
            Channel(channel): effect
            for channel, effect in self.derived_channel_incremental_effects
        }

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace

from attribution_lab.schemas.core import Channel


def _default_exposure() -> dict[Channel, float]:
    return {
        Channel.META: 0.28,
        Channel.GOOGLE_BRAND: 0.18,
        Channel.GOOGLE_NON_BRAND: 0.22,
        Channel.PINTEREST: 0.12,
        Channel.EMAIL: 0.20,
        Channel.ORGANIC: 0.30,
        Channel.DIRECT: 0.34,
        Channel.REFERRAL: 0.10,
    }


@dataclass(frozen=True, slots=True)
class WorldConfig:
    scenario_name: str = "balanced_multi_touch"
    n_subjects: int = 1000
    seed: int = 17
    baseline_conversion_probability: float = 0.04
    channel_exposure_probability: Mapping[Channel, float] = field(default_factory=_default_exposure)
    channel_log_odds_effect: Mapping[Channel, float] = field(default_factory=dict)
    interaction_log_odds_effect: Mapping[tuple[Channel, ...], float] = field(default_factory=dict)
    selection_strength: Mapping[Channel, float] = field(default_factory=dict)
    temporal_position: Mapping[Channel, float] = field(default_factory=dict)
    temporal_log_odds_effect: Mapping[str, float] = field(default_factory=dict)
    latent_intent_weight: float = 0.85
    max_touchpoints: int = 5
    observation_hours: float = 24.0 * 21
    order_value_mean: float = 180.0
    order_value_std: float = 75.0
    returning_session_probability: float = 0.45
    consent_granted_probability: float = 0.95

    def __post_init__(self) -> None:
        if self.n_subjects <= 0:
            raise ValueError("n_subjects must be positive")
        if not 0 < self.baseline_conversion_probability < 1:
            raise ValueError("baseline_conversion_probability must be within (0, 1)")
        if self.max_touchpoints <= 0:
            raise ValueError("max_touchpoints must be positive")
        if self.observation_hours <= 0:
            raise ValueError("observation_hours must be positive")
        for probability in self.channel_exposure_probability.values():
            if not 0 <= probability <= 1:
                raise ValueError("channel exposure probabilities must be within [0, 1]")


def scenario_config(name: str, *, seed: int = 17, n_subjects: int = 1000) -> WorldConfig:
    base = WorldConfig(seed=seed, n_subjects=n_subjects)
    balanced_effects = {
        Channel.META: 0.25,
        Channel.GOOGLE_BRAND: 0.20,
        Channel.GOOGLE_NON_BRAND: 0.25,
        Channel.PINTEREST: 0.18,
        Channel.EMAIL: 0.22,
        Channel.ORGANIC: 0.08,
        Channel.DIRECT: 0.0,
        Channel.REFERRAL: 0.10,
    }
    if name == "simple_single_touch":
        return replace(
            base,
            scenario_name=name,
            max_touchpoints=1,
            channel_log_odds_effect=balanced_effects,
        )
    if name == "balanced_multi_touch":
        return replace(base, scenario_name=name, channel_log_odds_effect=balanced_effects)
    if name == "pure_acquisition":
        return replace(
            base,
            scenario_name=name,
            channel_log_odds_effect={Channel.META: 1.35},
            temporal_position={Channel.META: 0.20},
        )
    if name in {"demand_capture", "brand_search_capture"}:
        return replace(
            base,
            scenario_name="demand_capture",
            channel_log_odds_effect={Channel.META: 0.90, Channel.GOOGLE_BRAND: 0.0},
            selection_strength={Channel.GOOGLE_BRAND: 1.65},
            temporal_position={Channel.META: 0.18, Channel.GOOGLE_BRAND: 0.92},
        )
    if name == "retargeting_selection":
        return replace(
            base,
            scenario_name=name,
            channel_exposure_probability={**_default_exposure(), Channel.META: 0.48},
            channel_log_odds_effect={Channel.META: 0.0, Channel.GOOGLE_NON_BRAND: 0.55},
            selection_strength={Channel.META: 2.0},
            temporal_position={Channel.META: 0.86},
        )
    if name == "assisted_conversion":
        return replace(
            base,
            scenario_name=name,
            channel_log_odds_effect={Channel.PINTEREST: 1.0, Channel.GOOGLE_BRAND: 0.05},
            temporal_position={Channel.PINTEREST: 0.12, Channel.GOOGLE_BRAND: 0.90},
        )
    if name in {"channel_interaction", "interaction_effect"}:
        return replace(
            base,
            scenario_name="channel_interaction",
            channel_log_odds_effect={Channel.META: 0.10, Channel.EMAIL: 0.10},
            interaction_log_odds_effect={(Channel.META, Channel.EMAIL): 1.10},
        )
    if name == "organic_direct_return":
        return replace(
            base,
            scenario_name=name,
            channel_log_odds_effect={Channel.META: 0.90, Channel.DIRECT: 0.0},
            temporal_position={Channel.META: 0.12, Channel.DIRECT: 0.92},
        )
    if name in {"null_channel", "null_paid_channel"}:
        return replace(
            base,
            scenario_name="null_channel",
            channel_exposure_probability={**_default_exposure(), Channel.PINTEREST: 0.52},
            channel_log_odds_effect={Channel.META: 0.65, Channel.PINTEREST: 0.0},
        )
    if name == "harmful_channel":
        return replace(
            base,
            scenario_name=name,
            channel_exposure_probability={**_default_exposure(), Channel.PINTEREST: 0.45},
            channel_log_odds_effect={Channel.META: 0.55, Channel.PINTEREST: -1.0},
        )
    if name == "strong_first_touch":
        return replace(
            base,
            scenario_name=name,
            channel_log_odds_effect=balanced_effects,
            temporal_position={Channel.META: 0.08},
            temporal_log_odds_effect={"first:meta": 1.15},
        )
    if name == "strong_final_touch":
        return replace(
            base,
            scenario_name=name,
            channel_log_odds_effect=balanced_effects,
            temporal_position={Channel.GOOGLE_NON_BRAND: 0.94},
            temporal_log_odds_effect={"last:google_non_brand": 1.15},
        )
    raise ValueError(f"unknown synthetic scenario: {name}")

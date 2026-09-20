from __future__ import annotations

from dataclasses import replace

from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.config import WorldConfig
from attribution_lab.stress.corruption import CorruptionConfig


def development_worlds() -> tuple[tuple[WorldConfig, CorruptionConfig], ...]:
    exposure = {
        Channel.META: 0.32,
        Channel.GOOGLE_BRAND: 0.24,
        Channel.GOOGLE_NON_BRAND: 0.26,
        Channel.PINTEREST: 0.20,
        Channel.EMAIL: 0.25,
        Channel.ORGANIC: 0.34,
        Channel.DIRECT: 0.31,
        Channel.REFERRAL: 0.15,
    }
    effects = {
        Channel.META: 0.35,
        Channel.GOOGLE_BRAND: 0.12,
        Channel.GOOGLE_NON_BRAND: 0.28,
        Channel.PINTEREST: 0.16,
        Channel.EMAIL: 0.30,
        Channel.ORGANIC: 0.07,
        Channel.DIRECT: 0.0,
        Channel.REFERRAL: 0.11,
    }
    balanced = WorldConfig(
        scenario_name="c2-dev-balanced-v1",
        n_subjects=320,
        seed=2201,
        baseline_conversion_probability=0.055,
        channel_exposure_probability=exposure,
        channel_log_odds_effect=effects,
        latent_intent_weight=0.45,
    )
    observed_selection = replace(
        balanced,
        scenario_name="c2-dev-observed-selection-v1",
        n_subjects=360,
        seed=2202,
        channel_log_odds_effect={**effects, Channel.META: 0.08},
        selection_strength={
            Channel.META: 1.15,
            Channel.GOOGLE_BRAND: 0.65,
        },
        latent_intent_weight=0.55,
    )
    null_selection = replace(
        balanced,
        scenario_name="c2-dev-null-selection-v1",
        n_subjects=360,
        seed=2203,
        channel_log_odds_effect={**effects, Channel.PINTEREST: 0.0},
        selection_strength={Channel.PINTEREST: 1.05},
        latent_intent_weight=0.50,
    )
    negative = replace(
        balanced,
        scenario_name="c2-dev-negative-v1",
        n_subjects=340,
        seed=2204,
        channel_log_odds_effect={**effects, Channel.EMAIL: -0.70},
        selection_strength={Channel.EMAIL: 0.35},
    )
    positivity = replace(
        balanced,
        scenario_name="c2-dev-positivity-v1",
        n_subjects=360,
        seed=2205,
        channel_exposure_probability={**exposure, Channel.META: 0.78},
        selection_strength={Channel.META: 0.90},
        channel_log_odds_effect={**effects, Channel.META: 0.20},
    )
    measurement = replace(
        balanced,
        scenario_name="c2-dev-measurement-v1",
        n_subjects=360,
        seed=2206,
    )
    return (
        (balanced, CorruptionConfig()),
        (observed_selection, CorruptionConfig()),
        (null_selection, CorruptionConfig()),
        (negative, CorruptionConfig()),
        (positivity, CorruptionConfig()),
        (
            measurement,
            CorruptionConfig(
                random_missing_touch_probability=0.20,
                identity_fragmentation_probability=0.10,
            ),
        ),
    )

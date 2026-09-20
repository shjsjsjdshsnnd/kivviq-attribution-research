from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from phase2_candidate_sdk import (
    ObservableConversion,
    ObservableDataset,
    ObservableJourney,
    ObservableSession,
    ObservableTouchpoint,
)

CHANNELS = ("channel_a", "channel_b", "channel_c", "channel_d")


@dataclass(frozen=True, slots=True)
class DevelopmentWorld:
    world_id: str
    dataset: ObservableDataset
    synthetic_truth: tuple[tuple[str, float], ...]


def _sigmoid(value: float) -> float:
    if value >= 0:
        exponent = math.exp(-value)
        return 1.0 / (1.0 + exponent)
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


def _world(
    world_id: str,
    *,
    seed: int,
    n_subjects: int,
    selection_strength: float,
    latent_intent_weight: float,
    effects: dict[str, float],
) -> DevelopmentWorld:
    rng = random.Random(seed)
    origin = datetime(2029, 1, 1, tzinfo=UTC)
    journeys: list[ObservableJourney] = []
    effect_sums = {channel: 0.0 for channel in CHANNELS}

    for index in range(n_subjects):
        intent = rng.gauss(0.0, 1.0)
        exposures: dict[str, bool] = {}
        for channel_index, channel in enumerate(CHANNELS):
            base_logit = -0.45 + channel_index * 0.12
            strength = selection_strength if channel == "channel_a" else selection_strength * 0.35
            probability = _sigmoid(base_logit + strength * intent)
            exposures[channel] = rng.random() < probability

        def probability(
            current_exposures: dict[str, bool],
            current_intent: float,
            force_channel: str | None = None,
            force_value: bool = False,
        ) -> float:
            linear = -2.45 + latent_intent_weight * current_intent
            for channel in CHANNELS:
                present = current_exposures[channel]
                if channel == force_channel:
                    present = force_value
                if present:
                    linear += effects[channel]
            return _sigmoid(linear)

        for channel in CHANNELS:
            effect_sums[channel] += probability(
                exposures,
                intent,
                channel,
                True,
            ) - probability(
                exposures,
                intent,
                channel,
                False,
            )

        start = origin + timedelta(minutes=index * 7)
        end = start + timedelta(days=21)
        sessions: list[ObservableSession] = []
        touch_index = 0
        for channel_index, channel in enumerate(CHANNELS):
            if not exposures[channel]:
                continue
            timestamp = start + timedelta(days=2 + channel_index * 3)
            touch = ObservableTouchpoint(
                event_id=f"dev-e-{index:05d}-{touch_index:02d}",
                timestamp=timestamp.isoformat(),
                channel=channel,
                campaign=f"synthetic-{channel}",
                utm_source=channel,
                utm_medium="synthetic",
                utm_campaign=world_id,
                click_id=f"dev-click-{index:05d}-{touch_index:02d}",
            )
            sessions.append(
                ObservableSession(
                    session_id=f"dev-s-{index:05d}-{touch_index:02d}",
                    start=timestamp.isoformat(),
                    end=(timestamp + timedelta(minutes=10)).isoformat(),
                    device="mobile" if rng.random() < 0.6 else "desktop",
                    touchpoints=(touch,),
                )
            )
            touch_index += 1

        converted = rng.random() < probability(exposures, intent)
        conversion = (
            ObservableConversion(
                conversion_id=f"dev-o-{index:05d}",
                timestamp=(start + timedelta(days=19)).isoformat(),
                value=150.0,
            )
            if converted
            else None
        )
        journeys.append(
            ObservableJourney(
                subject_id=f"dev-u-{index:05d}",
                observation_start=start.isoformat(),
                observation_end=end.isoformat(),
                sessions=tuple(sessions),
                conversion=conversion,
                consent_state="granted",
                identity_confidence=1.0,
                acquisition_evidence="synthetic",
                is_censored=False,
            )
        )

    return DevelopmentWorld(
        world_id=world_id,
        dataset=ObservableDataset(journeys=tuple(journeys)),
        synthetic_truth=tuple(
            sorted(
                (channel, total / n_subjects)
                for channel, total in effect_sums.items()
            )
        ),
    )


def development_worlds() -> tuple[DevelopmentWorld, ...]:
    return (
        _world(
            "candidate1-dev-randomized-v1",
            seed=101,
            n_subjects=400,
            selection_strength=0.0,
            latent_intent_weight=0.0,
            effects={
                "channel_a": 0.65,
                "channel_b": -0.45,
                "channel_c": 0.25,
                "channel_d": 0.0,
            },
        ),
        _world(
            "candidate1-dev-observed-selection-v1",
            seed=202,
            n_subjects=600,
            selection_strength=1.0,
            latent_intent_weight=0.75,
            effects={
                "channel_a": 0.0,
                "channel_b": 0.45,
                "channel_c": 0.20,
                "channel_d": 0.0,
            },
        ),
        _world(
            "candidate1-dev-null-effect-v1",
            seed=303,
            n_subjects=500,
            selection_strength=0.6,
            latent_intent_weight=0.0,
            effects={channel: 0.0 for channel in CHANNELS},
        ),
    )

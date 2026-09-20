from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from phase2_candidate_sdk import (
    ObservableConversion,
    ObservableDataset,
    ObservableJourney,
    ObservableSession,
    ObservableTouchpoint,
)

CHANNELS = (
    "channel_a",
    "channel_b",
    "channel_c",
    "channel_d",
    "channel_e",
    "channel_f",
    "channel_g",
    "channel_h",
)


@dataclass(frozen=True, slots=True)
class OracleTruth:
    estimand_key: str
    channel_effects: tuple[tuple[str, float], ...]


@dataclass(frozen=True, slots=True)
class GeneratedHoldout:
    family: str
    observable_dataset: ObservableDataset
    oracle_truth: OracleTruth


def _sigmoid(value: float) -> float:
    if value >= 0:
        exp_value = math.exp(-value)
        return 1.0 / (1.0 + exp_value)
    exp_value = math.exp(value)
    return exp_value / (1.0 + exp_value)


def _logit(probability: float) -> float:
    return math.log(probability / (1.0 - probability))


def _linear_predictor(
    params: dict[str, Any],
    latent_intent: float,
    heterogeneity: float,
    ordered: list[tuple[str, float]],
) -> float:
    channels = {channel for channel, _ in ordered}
    positions = dict(ordered)
    value = _logit(float(params["baseline_conversion_probability"]))
    value += float(params["latent_intent_weight"]) * latent_intent
    for channel in channels:
        effect = float(params["treatment_effects"][channel])
        if channel == params["heterogeneity_channel"]:
            effect += float(params["heterogeneity_strength"]) * heterogeneity
        value += effect
        if (
            channel == params["temporal_channel"]
            and positions[channel] >= float(params["temporal_change_point"])
        ):
            value += float(params["temporal_shift"])
        if (
            channel == params["delayed_channel"]
            and positions[channel] <= float(params["delayed_cutoff"])
        ):
            value += float(params["delayed_effect"])
    left, right = params["interaction_pair"]
    if left in channels and right in channels:
        value += float(params["interaction_effect"])
    return value


def _forced_order(
    params: dict[str, Any],
    ordered: list[tuple[str, float]],
    channel: str,
    present: bool,
) -> list[tuple[str, float]]:
    result = [(name, position) for name, position in ordered if name != channel]
    if present:
        result.append((channel, float(params["ordering_position"][channel])))
    result.sort(key=lambda item: (item[1], item[0]))
    return result


def _apply_measurement(
    journeys: list[ObservableJourney],
    params: dict[str, Any],
    rng: random.Random,
) -> tuple[ObservableJourney, ...]:
    observed: list[ObservableJourney] = []
    random_missing = float(params["random_missing_probability"])
    channel_missing_name = str(params["channel_missing_channel"])
    channel_missing = float(params["channel_missing_probability"])
    fragmentation = float(params["identity_fragmentation_probability"])

    for journey in journeys:
        sessions: list[ObservableSession] = []
        for session in journey.sessions:
            touches = tuple(
                touch
                for touch in session.touchpoints
                if rng.random() >= random_missing
                and not (
                    touch.channel == channel_missing_name
                    and rng.random() < channel_missing
                )
            )
            if touches:
                sessions.append(
                    ObservableSession(
                        session_id=session.session_id,
                        start=touches[0].timestamp,
                        end=session.end,
                        device=session.device,
                        touchpoints=touches,
                    )
                )
        if len(sessions) >= 2 and rng.random() < fragmentation:
            split = rng.randint(1, len(sessions) - 1)
            early = tuple(sessions[:split])
            late = tuple(sessions[split:])
            boundary = late[0].start
            early_conversion = (
                journey.conversion
                if journey.conversion is not None
                and journey.conversion.timestamp < boundary
                else None
            )
            late_conversion = (
                journey.conversion
                if journey.conversion is not None
                and journey.conversion.timestamp >= boundary
                else None
            )
            observed.extend(
                [
                    ObservableJourney(
                        subject_id=f"{journey.subject_id}-fragment-a",
                        observation_start=journey.observation_start,
                        observation_end=boundary,
                        sessions=early,
                        conversion=early_conversion,
                        consent_state=journey.consent_state,
                        identity_confidence=0.45,
                        acquisition_evidence=journey.acquisition_evidence,
                        is_censored=True,
                    ),
                    ObservableJourney(
                        subject_id=f"{journey.subject_id}-fragment-b",
                        observation_start=boundary,
                        observation_end=journey.observation_end,
                        sessions=late,
                        conversion=late_conversion,
                        consent_state=journey.consent_state,
                        identity_confidence=0.45,
                        acquisition_evidence="unknown",
                        is_censored=journey.is_censored,
                    ),
                ]
            )
        else:
            observed.append(
                ObservableJourney(
                    subject_id=journey.subject_id,
                    observation_start=journey.observation_start,
                    observation_end=journey.observation_end,
                    sessions=tuple(sessions),
                    conversion=journey.conversion,
                    consent_state=journey.consent_state,
                    identity_confidence=journey.identity_confidence,
                    acquisition_evidence=journey.acquisition_evidence,
                    is_censored=journey.is_censored,
                )
            )
    return tuple(observed)


def generate_holdout(
    params: dict[str, Any],
    *,
    seed: int,
) -> GeneratedHoldout:
    rng = random.Random(seed)
    origin = datetime(2030, 1, 1, tzinfo=UTC)
    pristine: list[ObservableJourney] = []
    marginal_sums = {channel: 0.0 for channel in CHANNELS}
    n_subjects = int(params["n_subjects"])

    for index in range(n_subjects):
        latent_intent = rng.gauss(0.0, 1.0)
        heterogeneity = rng.gauss(0.0, 1.0)
        exposed: list[str] = []
        for channel in CHANNELS:
            base = float(params["exposure_probability"][channel])
            selection = float(params["selection_strength"][channel])
            probability = _sigmoid(_logit(base) + selection * latent_intent)
            if rng.random() < probability:
                exposed.append(channel)
        max_touches = int(params["max_touches"])
        if len(exposed) > max_touches:
            exposed = rng.sample(exposed, max_touches)

        ordered = [
            (
                channel,
                min(
                    max(
                        float(params["ordering_position"][channel])
                        + rng.uniform(-0.08, 0.08),
                        0.02,
                    ),
                    0.96,
                ),
            )
            for channel in exposed
        ]
        ordered.sort(key=lambda item: (item[1], item[0]))

        for channel in CHANNELS:
            with_channel = _forced_order(params, ordered, channel, True)
            without_channel = _forced_order(params, ordered, channel, False)
            marginal_sums[channel] += _sigmoid(
                _linear_predictor(
                    params,
                    latent_intent,
                    heterogeneity,
                    with_channel,
                )
            ) - _sigmoid(
                _linear_predictor(
                    params,
                    latent_intent,
                    heterogeneity,
                    without_channel,
                )
            )

        start = origin + timedelta(minutes=index * 5)
        end = start + timedelta(days=21)
        sessions: list[ObservableSession] = []
        for touch_index, (channel, position) in enumerate(ordered):
            timestamp = start + timedelta(days=18 * position)
            touch = ObservableTouchpoint(
                event_id=f"h-e-{index:05d}-{touch_index:02d}",
                timestamp=timestamp.isoformat(),
                channel=channel,
                campaign=f"synthetic-holdout-{channel}",
                utm_source=channel,
                utm_medium="synthetic",
                utm_campaign=f"holdout-{params['family']}",
                click_id=f"hclk-{index:05d}-{touch_index:02d}",
                referrer=None,
            )
            sessions.append(
                ObservableSession(
                    session_id=f"h-s-{index:05d}-{touch_index:02d}",
                    start=timestamp.isoformat(),
                    end=(timestamp + timedelta(minutes=10)).isoformat(),
                    device="mobile" if rng.random() < 0.65 else "desktop",
                    touchpoints=(touch,),
                )
            )

        conversion_probability = _sigmoid(
            _linear_predictor(params, latent_intent, heterogeneity, ordered)
        )
        conversion = None
        if rng.random() < conversion_probability:
            latest = (
                datetime.fromisoformat(sessions[-1].end)
                if sessions
                else start
            )
            conversion_time = min(latest + timedelta(hours=4), end - timedelta(minutes=1))
            conversion = ObservableConversion(
                conversion_id=f"h-o-{index:05d}",
                timestamp=conversion_time.isoformat(),
                value=max(5.0, rng.gauss(180.0, 65.0)),
            )
        pristine.append(
            ObservableJourney(
                subject_id=f"h-u-{index:05d}",
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

    observed = _apply_measurement(pristine, params, rng)
    oracle = OracleTruth(
        estimand_key="incremental_conversion_probability",
        channel_effects=tuple(
            sorted(
                (
                    channel,
                    marginal_sums[channel] / n_subjects,
                )
                for channel in CHANNELS
            )
        ),
    )
    return GeneratedHoldout(
        family=str(params["family"]),
        observable_dataset=ObservableDataset(journeys=observed),
        oracle_truth=oracle,
    )

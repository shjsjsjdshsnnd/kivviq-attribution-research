from __future__ import annotations

import math
import random
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from attribution_lab.schemas.core import (
    PAID_CHANNELS,
    AcquisitionEvidence,
    Channel,
    ConsentState,
    Conversion,
    Dataset,
    Journey,
    Session,
    Touchpoint,
)
from attribution_lab.simulation.config import WorldConfig
from attribution_lab.simulation.manifest import GroundTruthManifest


def _sigmoid(value: float) -> float:
    if value >= 0:
        exponent = math.exp(-value)
        return 1.0 / (1.0 + exponent)
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


def _logit(probability: float) -> float:
    return math.log(probability / (1.0 - probability))


def _interaction_applies(channels: set[Channel], required: Iterable[Channel]) -> bool:
    return set(required).issubset(channels)


def _linear_predictor(
    config: WorldConfig,
    latent_intent: float,
    ordered_channels: list[Channel],
) -> float:
    channels = set(ordered_channels)
    value = _logit(config.baseline_conversion_probability)
    value += config.latent_intent_weight * latent_intent
    value += sum(config.channel_log_odds_effect.get(channel, 0.0) for channel in channels)
    for required, effect in config.interaction_log_odds_effect.items():
        if _interaction_applies(channels, required):
            value += effect
    if ordered_channels:
        value += config.temporal_log_odds_effect.get(
            f"first:{ordered_channels[0].value}",
            0.0,
        )
        value += config.temporal_log_odds_effect.get(
            f"last:{ordered_channels[-1].value}",
            0.0,
        )
    return value


def _intervened_order(
    config: WorldConfig,
    realized_order: list[Channel],
    intervened_channel: Channel,
    present: bool,
) -> list[Channel]:
    without = [channel for channel in realized_order if channel != intervened_channel]
    if not present:
        return without
    if intervened_channel in realized_order:
        return list(realized_order)

    def position(channel: Channel) -> float:
        if channel in config.temporal_position:
            return config.temporal_position[channel]
        if channel in realized_order:
            denominator = max(len(realized_order) - 1, 1)
            return realized_order.index(channel) / denominator
        return 0.5

    result = [*without, intervened_channel]
    result.sort(key=lambda channel: (position(channel), channel.value))
    return result


def _counterfactual_probability(
    config: WorldConfig,
    latent_intent: float,
    realized_order: list[Channel],
    intervened_channel: Channel,
    present: bool,
) -> float:
    order = _intervened_order(config, realized_order, intervened_channel, present)
    return _sigmoid(_linear_predictor(config, latent_intent, order))


@dataclass(frozen=True, slots=True)
class SyntheticWorld:
    dataset: Dataset
    manifest: GroundTruthManifest


def _sample_exposed_channels(
    config: WorldConfig,
    latent_intent: float,
    rng: random.Random,
) -> list[Channel]:
    exposed: list[Channel] = []
    for channel in Channel:
        base = config.channel_exposure_probability.get(channel, 0.0)
        if base <= 0:
            continue
        if base >= 1:
            probability = 1.0
        else:
            strength = config.selection_strength.get(channel, 0.0)
            probability = _sigmoid(_logit(base) + strength * latent_intent)
        if rng.random() < probability:
            exposed.append(channel)
    if len(exposed) > config.max_touchpoints:
        exposed = rng.sample(exposed, config.max_touchpoints)
    return exposed


def _ordered_channels(
    channels: list[Channel],
    config: WorldConfig,
    rng: random.Random,
) -> list[Channel]:
    ranked = [
        (
            min(max(config.temporal_position.get(channel, rng.random()), 0.0), 1.0),
            rng.random(),
            channel,
        )
        for channel in channels
    ]
    ranked.sort(key=lambda item: (item[0], item[1], item[2].value))
    return [channel for _, _, channel in ranked]


def _make_touch(
    subject_index: int,
    touch_index: int,
    channel: Channel,
    timestamp: datetime,
) -> Touchpoint:
    paid = channel in PAID_CHANNELS
    referral = channel in {Channel.ORGANIC, Channel.REFERRAL}
    return Touchpoint(
        event_id=f"e-{subject_index:06d}-{touch_index:02d}",
        timestamp=timestamp,
        channel=channel,
        campaign=f"synthetic-{channel.value}" if paid else None,
        utm_source=channel.value if paid or channel == Channel.EMAIL else None,
        utm_medium="paid" if paid else ("email" if channel == Channel.EMAIL else None),
        utm_campaign=f"scenario-{channel.value}" if paid or channel == Channel.EMAIL else None,
        click_id=f"clk-{subject_index:06d}-{touch_index:02d}" if paid else None,
        referrer=f"https://synthetic.example/{channel.value}" if referral else None,
    )


def _make_sessions(
    subject_index: int,
    touches: list[Touchpoint],
    rng: random.Random,
    returning_session_probability: float,
) -> tuple[Session, ...]:
    if not touches:
        return ()
    groups: list[list[Touchpoint]] = [[touches[0]]]
    for touch in touches[1:]:
        if rng.random() < returning_session_probability:
            groups.append([touch])
        else:
            groups[-1].append(touch)
    sessions: list[Session] = []
    for index, group in enumerate(groups):
        sessions.append(
            Session(
                session_id=f"s-{subject_index:06d}-{index:02d}",
                start=group[0].timestamp,
                end=group[-1].timestamp + timedelta(minutes=5),
                touchpoints=tuple(group),
                device="mobile" if rng.random() < 0.62 else "desktop",
            )
        )
    return tuple(sessions)


def _evidence_for_first_touch(touch: Touchpoint | None) -> AcquisitionEvidence:
    if touch is None:
        return AcquisitionEvidence.UNKNOWN
    if touch.click_id:
        return AcquisitionEvidence.CLICK_ID
    if touch.utm_source or touch.utm_medium or touch.utm_campaign:
        return AcquisitionEvidence.UTM
    if touch.referrer:
        return AcquisitionEvidence.REFERRER
    if touch.channel == Channel.DIRECT:
        return AcquisitionEvidence.DIRECT
    return AcquisitionEvidence.UNKNOWN


def generate_world(config: WorldConfig) -> SyntheticWorld:
    rng = random.Random(config.seed)
    origin = datetime(2026, 1, 1, tzinfo=UTC)
    journeys: list[Journey] = []
    causal_effect_sums = {channel: 0.0 for channel in Channel}

    for subject_index in range(config.n_subjects):
        start = origin + timedelta(minutes=subject_index * 3)
        end = start + timedelta(hours=config.observation_hours)
        latent_intent = rng.gauss(0.0, 1.0)
        exposed = _sample_exposed_channels(config, latent_intent, rng)
        ordered = _ordered_channels(exposed, config, rng)

        for channel in Channel:
            with_channel = _counterfactual_probability(
                config,
                latent_intent,
                ordered,
                channel,
                True,
            )
            without_channel = _counterfactual_probability(
                config,
                latent_intent,
                ordered,
                channel,
                False,
            )
            causal_effect_sums[channel] += with_channel - without_channel

        touches: list[Touchpoint] = []
        usable_hours = max(config.observation_hours * 0.82, 0.1)
        count = len(ordered)
        for touch_index, channel in enumerate(ordered):
            if count == 1:
                fraction = config.temporal_position.get(channel, 0.35)
            else:
                fraction = config.temporal_position.get(
                    channel,
                    0.08 + 0.72 * touch_index / max(count - 1, 1),
                )
            fraction = min(max(fraction + rng.uniform(-0.025, 0.025), 0.01), 0.90)
            timestamp = start + timedelta(hours=usable_hours * fraction)
            touches.append(_make_touch(subject_index, touch_index, channel, timestamp))
        touches.sort(key=lambda touch: (touch.timestamp, touch.event_id))

        conversion_probability = _sigmoid(_linear_predictor(config, latent_intent, ordered))
        converted = rng.random() < conversion_probability
        conversion: Conversion | None = None
        if converted:
            latest_touch = touches[-1].timestamp if touches else start
            remaining_seconds = max((end - latest_touch).total_seconds() - 60.0, 60.0)
            lag_seconds = min(rng.expovariate(1.0 / 21600.0), remaining_seconds)
            conversion_time = latest_touch + timedelta(seconds=max(lag_seconds, 60.0))
            if conversion_time >= end:
                conversion_time = end - timedelta(seconds=1)
            conversion = Conversion(
                conversion_id=f"o-{subject_index:06d}",
                timestamp=conversion_time,
                value=max(5.0, rng.gauss(config.order_value_mean, config.order_value_std)),
            )

        sessions = _make_sessions(
            subject_index,
            touches,
            rng,
            config.returning_session_probability,
        )
        consent = (
            ConsentState.GRANTED
            if rng.random() < config.consent_granted_probability
            else ConsentState.DENIED
        )
        first_touch = touches[0] if touches else None
        journeys.append(
            Journey(
                subject_id=f"u-{subject_index:06d}",
                observation_start=start,
                observation_end=end,
                sessions=sessions,
                conversion=conversion,
                consent_state=consent,
                identity_confidence=1.0,
                acquisition_evidence=_evidence_for_first_touch(first_touch),
                is_censored=False,
            )
        )

    average_effects = {
        channel: total / config.n_subjects for channel, total in causal_effect_sums.items()
    }
    manifest = GroundTruthManifest.from_config(config, average_effects)
    return SyntheticWorld(dataset=Dataset(tuple(journeys)), manifest=manifest)

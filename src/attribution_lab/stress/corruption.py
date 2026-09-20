from __future__ import annotations

import random
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta

from attribution_lab.schemas.core import (
    AcquisitionEvidence,
    Channel,
    ConsentState,
    Conversion,
    Dataset,
    Journey,
    Session,
    Touchpoint,
)
from attribution_lab.simulation.generator import SyntheticWorld


@dataclass(frozen=True, slots=True)
class CorruptionConfig:
    random_missing_touch_probability: float = 0.0
    channel_missing_probability: Mapping[Channel, float] = field(default_factory=dict)
    missing_utm_probability: float = 0.0
    corrupted_utm_probability: float = 0.0
    missing_click_id_probability: float = 0.0
    identity_fragmentation_probability: float = 0.0
    cross_device_fragmentation_probability: float = 0.0
    cookie_loss_probability: float = 0.0
    session_splitting_probability: float = 0.0
    delayed_event_probability: float = 0.0
    delay_hours: float = 48.0
    duplicate_event_probability: float = 0.0
    missing_purchase_probability: float = 0.0
    missing_non_purchaser_probability: float = 0.0
    consent_exclusion_probability: float = 0.0
    censor_probability: float = 0.0

    def __post_init__(self) -> None:
        probabilities = [
            self.random_missing_touch_probability,
            self.missing_utm_probability,
            self.corrupted_utm_probability,
            self.missing_click_id_probability,
            self.identity_fragmentation_probability,
            self.cross_device_fragmentation_probability,
            self.cookie_loss_probability,
            self.session_splitting_probability,
            self.delayed_event_probability,
            self.duplicate_event_probability,
            self.missing_purchase_probability,
            self.missing_non_purchaser_probability,
            self.consent_exclusion_probability,
            self.censor_probability,
            *self.channel_missing_probability.values(),
        ]
        if any(probability < 0 or probability > 1 for probability in probabilities):
            raise ValueError("corruption probabilities must be within [0, 1]")
        if self.delay_hours < 0:
            raise ValueError("delay_hours must be non-negative")


def _corrupt_touch(
    touch: Touchpoint,
    config: CorruptionConfig,
    rng: random.Random,
) -> Touchpoint | None:
    channel_missing = config.channel_missing_probability.get(touch.channel, 0.0)
    if rng.random() < config.random_missing_touch_probability or rng.random() < channel_missing:
        return None

    result = touch
    if rng.random() < config.missing_utm_probability:
        result = replace(result, utm_source=None, utm_medium=None, utm_campaign=None)
    elif rng.random() < config.corrupted_utm_probability:
        result = replace(result, utm_source="corrupted", utm_campaign="corrupted")

    if rng.random() < config.missing_click_id_probability:
        result = replace(result, click_id=None)
    if rng.random() < config.delayed_event_probability:
        result = replace(result, timestamp=result.timestamp + timedelta(hours=config.delay_hours))
    return result


def _corrupt_sessions(
    journey: Journey,
    config: CorruptionConfig,
    rng: random.Random,
) -> tuple[Session, ...]:
    preserved: list[Session] = []
    for source_session in journey.sessions:
        touches: list[Touchpoint] = []
        for touch in source_session.touchpoints:
            corrupted = _corrupt_touch(touch, config, rng)
            if corrupted is None:
                continue
            touches.append(corrupted)
            if rng.random() < config.duplicate_event_probability:
                touches.append(
                    replace(
                        corrupted,
                        event_id=f"{corrupted.event_id}-dup",
                        timestamp=corrupted.timestamp + timedelta(milliseconds=1),
                    )
                )
        touches.sort(key=lambda item: (item.timestamp, item.event_id))
        if not touches:
            continue
        preserved.append(
            Session(
                session_id=f"{source_session.session_id}-corrupt",
                start=touches[0].timestamp,
                end=touches[-1].timestamp + timedelta(minutes=1),
                touchpoints=tuple(touches),
                device=source_session.device,
            )
        )

    preserved.sort(key=lambda session: (session.start, session.session_id))
    if not preserved:
        return ()
    if rng.random() >= config.session_splitting_probability:
        return tuple(preserved)

    split: list[Session] = []
    for session in preserved:
        for touch in session.touchpoints:
            split.append(
                Session(
                    session_id=f"{journey.subject_id}-split-{len(split):02d}",
                    start=touch.timestamp,
                    end=touch.timestamp + timedelta(minutes=1),
                    touchpoints=(touch,),
                    device=session.device,
                )
            )
    split.sort(key=lambda session: (session.start, session.session_id))
    return tuple(split)


def _truncate_sessions(
    sessions: tuple[Session, ...],
    observation_end: datetime,
) -> tuple[Session, ...]:
    end = observation_end
    truncated: list[Session] = []
    for session in sessions:
        touches = tuple(touch for touch in session.touchpoints if touch.timestamp < end)
        if not touches:
            continue
        truncated.append(
            replace(
                session,
                start=touches[0].timestamp,
                end=min(session.end, end),
                touchpoints=touches,
            )
        )
    return tuple(truncated)


def _evidence_for_sessions(
    sessions: tuple[Session, ...],
    fallback: AcquisitionEvidence,
) -> AcquisitionEvidence:
    if not sessions or not sessions[0].touchpoints:
        return AcquisitionEvidence.UNKNOWN
    first_touch = sessions[0].touchpoints[0]
    if first_touch.click_id is not None:
        return AcquisitionEvidence.CLICK_ID
    if first_touch.utm_source or first_touch.utm_medium or first_touch.utm_campaign:
        return AcquisitionEvidence.UTM
    if first_touch.referrer:
        return AcquisitionEvidence.REFERRER
    if first_touch.channel == Channel.DIRECT:
        return AcquisitionEvidence.DIRECT
    return fallback if fallback == AcquisitionEvidence.UNKNOWN else AcquisitionEvidence.UNKNOWN


def _split_identity(
    journey: Journey,
    *,
    sessions: tuple[Session, ...],
    conversion: Conversion | None,
    identity_confidence: float,
    rng: random.Random,
    identity_trigger: bool,
    cookie_trigger: bool,
) -> list[Journey]:
    if not (identity_trigger or cookie_trigger) or len(sessions) < 2:
        return [
            replace(
                journey,
                sessions=sessions,
                conversion=conversion,
                identity_confidence=identity_confidence,
                acquisition_evidence=_evidence_for_sessions(
                    sessions,
                    journey.acquisition_evidence,
                ),
            )
        ]

    split_index = rng.randint(1, len(sessions) - 1)
    early_sessions = sessions[:split_index]
    late_sessions = sessions[split_index:]
    boundary = late_sessions[0].start
    early_conversion = (
        conversion
        if conversion is not None and conversion.timestamp < boundary
        else None
    )
    late_conversion = (
        conversion
        if conversion is not None and conversion.timestamp >= boundary
        else None
    )
    factor = 0.45 if identity_trigger else 0.60
    confidence = max(min(identity_confidence * factor, 1.0), 0.0)

    early = replace(
        journey,
        subject_id=f"{journey.subject_id}-fragment-a",
        observation_end=boundary,
        sessions=early_sessions,
        conversion=early_conversion,
        identity_confidence=confidence,
        acquisition_evidence=_evidence_for_sessions(
            early_sessions,
            journey.acquisition_evidence,
        ),
        is_censored=True,
    )
    late = replace(
        journey,
        subject_id=f"{journey.subject_id}-fragment-b",
        observation_start=boundary,
        sessions=late_sessions,
        conversion=late_conversion,
        identity_confidence=confidence,
        acquisition_evidence=_evidence_for_sessions(
            late_sessions,
            AcquisitionEvidence.UNKNOWN,
        ),
        is_censored=journey.is_censored,
    )
    return [early, late]


def corrupt_world(
    world: SyntheticWorld,
    config: CorruptionConfig,
    *,
    seed: int = 991,
) -> SyntheticWorld:
    """Corrupt observations while preserving the exact latent-truth manifest."""
    rng = random.Random(seed)
    corrupted_journeys: list[Journey] = []

    for journey in world.dataset.journeys:
        is_purchaser = journey.qualifying_conversion() is not None
        if not is_purchaser and rng.random() < config.missing_non_purchaser_probability:
            continue

        sessions = _corrupt_sessions(journey, config, rng)
        conversion = journey.conversion
        if is_purchaser and rng.random() < config.missing_purchase_probability:
            conversion = None

        consent = journey.consent_state
        if rng.random() < config.consent_exclusion_probability:
            consent = ConsentState.DENIED

        observation_end = journey.observation_end
        censored = journey.is_censored
        if rng.random() < config.censor_probability:
            fraction = rng.uniform(0.35, 0.80)
            duration = journey.observation_end - journey.observation_start
            observation_end = journey.observation_start + duration * fraction
            sessions = _truncate_sessions(sessions, observation_end)
            if conversion is not None and conversion.timestamp >= observation_end:
                conversion = None
            censored = True

        identity_confidence = journey.identity_confidence
        cross_device_trigger = rng.random() < config.cross_device_fragmentation_probability
        if cross_device_trigger:
            identity_confidence *= 0.65

        identity_trigger = rng.random() < config.identity_fragmentation_probability
        cookie_trigger = rng.random() < config.cookie_loss_probability

        base = replace(
            journey,
            observation_end=observation_end,
            sessions=sessions,
            conversion=conversion,
            consent_state=consent,
            identity_confidence=max(min(identity_confidence, 1.0), 0.0),
            is_censored=censored,
        )
        corrupted_journeys.extend(
            _split_identity(
                base,
                sessions=base.sessions,
                conversion=base.conversion,
                identity_confidence=base.identity_confidence,
                rng=rng,
                identity_trigger=identity_trigger,
                cookie_trigger=cookie_trigger,
            )
        )

    return SyntheticWorld(
        dataset=Dataset(tuple(corrupted_journeys)),
        manifest=world.manifest,
    )

from __future__ import annotations

import random
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import timedelta

from attribution_lab.schemas.core import (
    AcquisitionEvidence,
    Channel,
    ConsentState,
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
    touches: list[Touchpoint] = []
    for touch in journey.ordered_touchpoints():
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
        return ()

    groups = (
        [[touch] for touch in touches]
        if rng.random() < config.session_splitting_probability
        else [touches]
    )
    sessions: list[Session] = []
    for index, group in enumerate(groups):
        sessions.append(
            Session(
                session_id=f"{journey.subject_id}-corrupt-{index:02d}",
                start=group[0].timestamp,
                end=group[-1].timestamp + timedelta(minutes=1),
                touchpoints=tuple(group),
                device="mobile" if rng.random() < 0.5 else "desktop",
            )
        )
    return tuple(sessions)


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

        identity_confidence = journey.identity_confidence
        subject_id = journey.subject_id
        if rng.random() < config.identity_fragmentation_probability:
            identity_confidence *= 0.45
            subject_id = f"{subject_id}-fragment"
        if rng.random() < config.cross_device_fragmentation_probability:
            identity_confidence *= 0.65
        if rng.random() < config.cookie_loss_probability:
            identity_confidence *= 0.60

        first_touch = sessions[0].touchpoints[0] if sessions and sessions[0].touchpoints else None
        evidence = journey.acquisition_evidence
        if first_touch is None:
            evidence = AcquisitionEvidence.UNKNOWN
        elif first_touch.click_id is None and evidence == AcquisitionEvidence.CLICK_ID:
            evidence = (
                AcquisitionEvidence.UTM
                if first_touch.utm_source is not None
                else AcquisitionEvidence.UNKNOWN
            )

        corrupted_journeys.append(
            replace(
                journey,
                subject_id=subject_id,
                sessions=sessions,
                conversion=conversion,
                consent_state=consent,
                identity_confidence=max(min(identity_confidence, 1.0), 0.0),
                acquisition_evidence=evidence,
                is_censored=journey.is_censored or rng.random() < config.censor_probability,
            )
        )

    return SyntheticWorld(
        dataset=Dataset(tuple(corrupted_journeys)),
        manifest=world.manifest,
    )

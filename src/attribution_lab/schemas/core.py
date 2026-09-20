from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class Channel(StrEnum):
    META = "meta"
    GOOGLE_BRAND = "google_brand"
    GOOGLE_NON_BRAND = "google_non_brand"
    PINTEREST = "pinterest"
    EMAIL = "email"
    ORGANIC = "organic"
    DIRECT = "direct"
    REFERRAL = "referral"


PAID_CHANNELS = frozenset(
    {
        Channel.META,
        Channel.GOOGLE_BRAND,
        Channel.GOOGLE_NON_BRAND,
        Channel.PINTEREST,
    }
)


class ConsentState(StrEnum):
    GRANTED = "granted"
    DENIED = "denied"
    UNKNOWN = "unknown"


class AcquisitionEvidence(StrEnum):
    CLICK_ID = "click_id"
    UTM = "utm"
    REFERRER = "referrer"
    DIRECT = "direct"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class Touchpoint:
    event_id: str
    timestamp: datetime
    channel: Channel
    campaign: str | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    click_id: str | None = None
    referrer: str | None = None

    @property
    def is_paid(self) -> bool:
        return self.channel in PAID_CHANNELS


@dataclass(frozen=True, slots=True)
class Session:
    session_id: str
    start: datetime
    end: datetime
    touchpoints: tuple[Touchpoint, ...]
    device: str = "desktop"

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ValueError("session end must not precede session start")
        timestamps = [touch.timestamp for touch in self.touchpoints]
        if timestamps != sorted(timestamps):
            raise ValueError("touchpoints must be supplied in explicit timestamp order")


@dataclass(frozen=True, slots=True)
class Conversion:
    conversion_id: str
    timestamp: datetime
    value: float

    def __post_init__(self) -> None:
        if self.value < 0:
            raise ValueError("conversion value cannot be negative")


@dataclass(frozen=True, slots=True)
class Journey:
    subject_id: str
    observation_start: datetime
    observation_end: datetime
    sessions: tuple[Session, ...]
    conversion: Conversion | None
    consent_state: ConsentState = ConsentState.GRANTED
    identity_confidence: float = 1.0
    acquisition_evidence: AcquisitionEvidence = AcquisitionEvidence.UNKNOWN
    is_censored: bool = False

    def __post_init__(self) -> None:
        if self.observation_end <= self.observation_start:
            raise ValueError("observation_end must follow observation_start")
        if not 0.0 <= self.identity_confidence <= 1.0:
            raise ValueError("identity_confidence must be within [0, 1]")
        starts = [session.start for session in self.sessions]
        if starts != sorted(starts):
            raise ValueError("sessions must be supplied in explicit start-time order")

    def ordered_touchpoints(self) -> tuple[Touchpoint, ...]:
        touches = [touch for session in self.sessions for touch in session.touchpoints]
        return tuple(sorted(touches, key=lambda touch: (touch.timestamp, touch.event_id)))

    def qualifying_conversion(self) -> Conversion | None:
        conversion = self.conversion
        if conversion is None:
            return None
        if self.observation_start <= conversion.timestamp < self.observation_end:
            return conversion
        return None

    def attribution_touchpoints(self) -> tuple[Touchpoint, ...]:
        """Return only touches observable before the outcome being attributed."""
        if self.consent_state == ConsentState.DENIED:
            return ()
        conversion = self.qualifying_conversion()
        boundary = conversion.timestamp if conversion is not None else self.observation_end
        return tuple(
            touch
            for touch in self.ordered_touchpoints()
            if self.observation_start <= touch.timestamp < boundary
        )


@dataclass(frozen=True, slots=True)
class Dataset:
    journeys: tuple[Journey, ...]

    def purchasers(self) -> tuple[Journey, ...]:
        return tuple(
            journey
            for journey in self.journeys
            if journey.consent_state != ConsentState.DENIED
            and journey.qualifying_conversion() is not None
        )

    def completed_non_purchasers(self) -> tuple[Journey, ...]:
        return tuple(
            journey
            for journey in self.journeys
            if journey.consent_state != ConsentState.DENIED
            and not journey.is_censored
            and journey.qualifying_conversion() is None
        )

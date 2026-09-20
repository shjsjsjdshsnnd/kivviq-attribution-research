from datetime import UTC, datetime, timedelta

from attribution_lab.evaluation.horizon import HorizonLabel, label_horizon
from attribution_lab.schemas.core import (
    Channel,
    ConsentState,
    Conversion,
    Journey,
    Session,
    Touchpoint,
)


def _journey_with_late_purchase() -> Journey:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    before = Touchpoint("before", start + timedelta(hours=1), Channel.META)
    after = Touchpoint("after", start + timedelta(days=4), Channel.GOOGLE_BRAND)
    session = Session(
        "session",
        before.timestamp,
        after.timestamp + timedelta(minutes=1),
        (before, after),
    )
    return Journey(
        subject_id="subject",
        observation_start=start,
        observation_end=start + timedelta(days=10),
        sessions=(session,),
        conversion=Conversion("order", start + timedelta(days=3), 100.0),
        consent_state=ConsentState.GRANTED,
    )


def test_later_purchase_does_not_leak_into_earlier_negative_horizon() -> None:
    journey = _journey_with_late_purchase()
    assert label_horizon(journey, timedelta(days=2)) == HorizonLabel.NEGATIVE


def test_incomplete_horizon_is_censored() -> None:
    journey = _journey_with_late_purchase()
    available_until = journey.observation_start + timedelta(days=1)
    assert (
        label_horizon(
            journey,
            timedelta(days=2),
            data_available_until=available_until,
        )
        == HorizonLabel.CENSORED
    )


def test_future_touchpoint_cannot_receive_credit_for_conversion() -> None:
    journey = _journey_with_late_purchase()
    assert [touch.event_id for touch in journey.attribution_touchpoints()] == ["before"]

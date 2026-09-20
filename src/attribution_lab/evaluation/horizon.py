from __future__ import annotations

from datetime import datetime, timedelta
from enum import StrEnum

from attribution_lab.schemas.core import Journey


class HorizonLabel(StrEnum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    CENSORED = "censored"


def label_horizon(
    journey: Journey,
    horizon: timedelta,
    *,
    data_available_until: datetime | None = None,
) -> HorizonLabel:
    """Label Y_H without using outcomes after the declared horizon."""
    if horizon.total_seconds() <= 0:
        raise ValueError("horizon must be positive")

    horizon_end = journey.observation_start + horizon
    observable_until = min(
        journey.observation_end,
        data_available_until if data_available_until is not None else journey.observation_end,
    )
    if observable_until < horizon_end or journey.is_censored:
        return HorizonLabel.CENSORED

    conversion = journey.conversion
    if (
        conversion is not None
        and journey.observation_start <= conversion.timestamp < horizon_end
    ):
        return HorizonLabel.POSITIVE
    return HorizonLabel.NEGATIVE

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from attribution_lab.schemas.core import Channel, ConsentState, Journey


@dataclass(frozen=True, slots=True)
class AttributionResult:
    channel_credit: dict[Channel, float]
    diagnostics: dict[str, Any]

    @property
    def total_credit(self) -> float:
        return sum(self.channel_credit.values())


class AttributionModel(ABC):
    name: str

    @abstractmethod
    def attribute(self, journeys: Sequence[Journey]) -> AttributionResult:
        raise NotImplementedError


def empty_scores() -> dict[Channel, float]:
    return {channel: 0.0 for channel in Channel}


def normalize_scores(scores: Mapping[Channel, float]) -> dict[Channel, float]:
    completed = {channel: max(float(scores.get(channel, 0.0)), 0.0) for channel in Channel}
    total = sum(completed.values())
    if total <= 0.0:
        return completed
    return {channel: value / total for channel, value in completed.items()}


def converted_journeys(journeys: Sequence[Journey]) -> list[Journey]:
    return [
        journey
        for journey in journeys
        if journey.consent_state != ConsentState.DENIED
        and journey.qualifying_conversion() is not None
    ]


def completed_analysis_journeys(journeys: Sequence[Journey]) -> list[Journey]:
    return [
        journey
        for journey in journeys
        if journey.consent_state != ConsentState.DENIED and not journey.is_censored
    ]


def conversion_weight(journey: Journey) -> float:
    conversion = journey.qualifying_conversion()
    if conversion is None:
        return 0.0
    return conversion.value if conversion.value > 0.0 else 1.0

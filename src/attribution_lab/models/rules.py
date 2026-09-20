from __future__ import annotations

import math
from collections.abc import Sequence

from attribution_lab.models.base import (
    AttributionModel,
    AttributionResult,
    conversion_weight,
    converted_journeys,
    empty_scores,
    normalize_scores,
)
from attribution_lab.schemas.core import Journey, Touchpoint


class FirstTouchModel(AttributionModel):
    name = "first_touch"

    def attribute(self, journeys: Sequence[Journey]) -> AttributionResult:
        scores = empty_scores()
        used = 0
        for journey in converted_journeys(journeys):
            touches = journey.attribution_touchpoints()
            if not touches:
                continue
            scores[touches[0].channel] += conversion_weight(journey)
            used += 1
        return AttributionResult(normalize_scores(scores), {"model": self.name, "used": used})


class LastTouchModel(AttributionModel):
    name = "last_touch"

    def attribute(self, journeys: Sequence[Journey]) -> AttributionResult:
        scores = empty_scores()
        used = 0
        for journey in converted_journeys(journeys):
            touches = journey.attribution_touchpoints()
            if not touches:
                continue
            scores[touches[-1].channel] += conversion_weight(journey)
            used += 1
        return AttributionResult(normalize_scores(scores), {"model": self.name, "used": used})


class LastPaidTouchModel(AttributionModel):
    name = "last_paid_touch"

    def attribute(self, journeys: Sequence[Journey]) -> AttributionResult:
        scores = empty_scores()
        paid_paths = 0
        fallback_paths = 0
        for journey in converted_journeys(journeys):
            touches = journey.attribution_touchpoints()
            if not touches:
                continue
            paid = [touch for touch in touches if touch.is_paid]
            selected = paid[-1] if paid else touches[-1]
            scores[selected.channel] += conversion_weight(journey)
            paid_paths += int(bool(paid))
            fallback_paths += int(not paid)
        return AttributionResult(
            normalize_scores(scores),
            {
                "model": self.name,
                "paid_paths": paid_paths,
                "fallback_to_last_touch_paths": fallback_paths,
            },
        )


class LinearModel(AttributionModel):
    name = "linear"

    def attribute(self, journeys: Sequence[Journey]) -> AttributionResult:
        scores = empty_scores()
        used = 0
        for journey in converted_journeys(journeys):
            touches = journey.attribution_touchpoints()
            if not touches:
                continue
            share = conversion_weight(journey) / len(touches)
            for touch in touches:
                scores[touch.channel] += share
            used += 1
        return AttributionResult(normalize_scores(scores), {"model": self.name, "used": used})


class TimeDecayModel(AttributionModel):
    name = "time_decay"

    def __init__(self, half_life_hours: float = 168.0) -> None:
        if half_life_hours <= 0:
            raise ValueError("half_life_hours must be positive")
        self.half_life_hours = half_life_hours

    def attribute(self, journeys: Sequence[Journey]) -> AttributionResult:
        scores = empty_scores()
        used = 0
        for journey in converted_journeys(journeys):
            touches = journey.attribution_touchpoints()
            conversion = journey.qualifying_conversion()
            if not touches or conversion is None:
                continue
            weights: list[tuple[Touchpoint, float]] = []
            for touch in touches:
                age_hours = (conversion.timestamp - touch.timestamp).total_seconds() / 3600.0
                weight = math.exp(-math.log(2.0) * max(age_hours, 0.0) / self.half_life_hours)
                weights.append((touch, weight))
            denominator = sum(weight for _, weight in weights)
            value = conversion_weight(journey)
            for touch, weight in weights:
                scores[touch.channel] += value * weight / denominator
            used += 1
        return AttributionResult(
            normalize_scores(scores),
            {"model": self.name, "half_life_hours": self.half_life_hours, "used": used},
        )


class PositionBasedModel(AttributionModel):
    name = "position_based"

    def __init__(self, first_weight: float = 0.4, last_weight: float = 0.4) -> None:
        if first_weight < 0 or last_weight < 0 or first_weight + last_weight > 1:
            raise ValueError("position weights must be non-negative and sum to at most 1")
        self.first_weight = first_weight
        self.last_weight = last_weight

    def _weights(self, length: int) -> list[float]:
        if length <= 0:
            return []
        if length == 1:
            return [1.0]
        if length == 2:
            total = self.first_weight + self.last_weight
            if total <= 0:
                return [0.5, 0.5]
            return [self.first_weight / total, self.last_weight / total]
        middle_total = 1.0 - self.first_weight - self.last_weight
        return [
            self.first_weight,
            *([middle_total / (length - 2)] * (length - 2)),
            self.last_weight,
        ]

    def attribute(self, journeys: Sequence[Journey]) -> AttributionResult:
        scores = empty_scores()
        used = 0
        for journey in converted_journeys(journeys):
            touches = journey.attribution_touchpoints()
            if not touches:
                continue
            value = conversion_weight(journey)
            for touch, weight in zip(touches, self._weights(len(touches)), strict=True):
                scores[touch.channel] += value * weight
            used += 1
        return AttributionResult(
            normalize_scores(scores),
            {
                "model": self.name,
                "first_weight": self.first_weight,
                "last_weight": self.last_weight,
                "used": used,
            },
        )

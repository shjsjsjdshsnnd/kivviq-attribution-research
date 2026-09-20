from __future__ import annotations

import math
from collections.abc import Sequence
from itertools import combinations

from attribution_lab.models.base import (
    AttributionModel,
    AttributionResult,
    completed_analysis_journeys,
    normalize_scores,
)
from attribution_lab.schemas.core import Channel, Journey


class ShapleyAttributionModel(AttributionModel):
    """Exact Shapley values over a smoothed empirical conversion-rate game."""

    name = "shapley"

    def __init__(self, prior_strength: float = 2.0) -> None:
        if prior_strength < 0:
            raise ValueError("prior_strength must be non-negative")
        self.prior_strength = prior_strength

    def attribute(self, journeys: Sequence[Journey]) -> AttributionResult:
        completed = completed_analysis_journeys(journeys)
        rows = [
            (
                frozenset(touch.channel for touch in journey.attribution_touchpoints()),
                journey.qualifying_conversion() is not None,
            )
            for journey in completed
        ]
        present = sorted(
            {channel for path, _ in rows for channel in path},
            key=lambda channel: channel.value,
        )
        if not rows or not present:
            return AttributionResult(
                normalize_scores({}),
                {"model": self.name, "raw_shapley": {}, "completed_paths": len(rows)},
            )

        global_rate = sum(int(converted) for _, converted in rows) / len(rows)
        cache: dict[frozenset[Channel], float] = {}

        def value(coalition: frozenset[Channel]) -> float:
            if coalition in cache:
                return cache[coalition]
            selected = [converted for path, converted in rows if path.issubset(coalition)]
            successes = sum(int(converted) for converted in selected)
            denominator = len(selected) + self.prior_strength
            result = (
                global_rate
                if denominator <= 0
                else (successes + self.prior_strength * global_rate) / denominator
            )
            cache[coalition] = result
            return result

        n_channels = len(present)
        factorial_n = math.factorial(n_channels)
        raw: dict[Channel, float] = {}
        for channel in present:
            others = [candidate for candidate in present if candidate != channel]
            contribution = 0.0
            for size in range(len(others) + 1):
                weight = (
                    math.factorial(size)
                    * math.factorial(n_channels - size - 1)
                    / factorial_n
                )
                for subset_tuple in combinations(others, size):
                    subset = frozenset(subset_tuple)
                    contribution += weight * (value(subset | {channel}) - value(subset))
            raw[channel] = contribution

        return AttributionResult(
            normalize_scores({channel: max(score, 0.0) for channel, score in raw.items()}),
            {
                "model": self.name,
                "prior_strength": self.prior_strength,
                "raw_shapley": {
                    channel.value: raw.get(channel, 0.0) for channel in Channel
                },
                "completed_paths": len(rows),
            },
        )

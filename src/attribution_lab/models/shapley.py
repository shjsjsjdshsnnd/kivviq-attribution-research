from __future__ import annotations

import math
from collections import defaultdict
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
        path_summary: dict[frozenset[Channel], list[int]] = defaultdict(lambda: [0, 0])
        for journey in completed:
            path = frozenset(
                touch.channel for touch in journey.attribution_touchpoints()
            )
            path_summary[path][0] += 1
            path_summary[path][1] += int(journey.qualifying_conversion() is not None)

        present = sorted(
            {channel for path in path_summary for channel in path},
            key=lambda channel: channel.value,
        )
        completed_count = sum(count for count, _ in path_summary.values())
        conversion_count = sum(converted for _, converted in path_summary.values())
        if completed_count == 0 or not present:
            return AttributionResult(
                normalize_scores({}),
                {
                    "model": self.name,
                    "raw_shapley": {},
                    "completed_paths": completed_count,
                    "unique_path_sets": len(path_summary),
                    "coalition_universe": 1,
                    "observed_set_support_ratio": 0.0,
                    "min_path_set_count": 0,
                },
            )

        global_rate = conversion_count / completed_count
        cache: dict[frozenset[Channel], float] = {}

        def value(coalition: frozenset[Channel]) -> float:
            if coalition in cache:
                return cache[coalition]
            selected_count = 0
            successes = 0
            for path, (count, converted) in path_summary.items():
                if path.issubset(coalition):
                    selected_count += count
                    successes += converted
            denominator = selected_count + self.prior_strength
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

        coalition_universe = 2**n_channels
        path_counts = [count for count, _ in path_summary.values()]
        return AttributionResult(
            normalize_scores({channel: max(score, 0.0) for channel, score in raw.items()}),
            {
                "model": self.name,
                "prior_strength": self.prior_strength,
                "raw_shapley": {
                    channel.value: raw.get(channel, 0.0) for channel in Channel
                },
                "completed_paths": completed_count,
                "unique_path_sets": len(path_summary),
                "coalition_universe": coalition_universe,
                "observed_set_support_ratio": len(path_summary) / coalition_universe,
                "min_path_set_count": min(path_counts) if path_counts else 0,
                "max_path_set_count": max(path_counts) if path_counts else 0,
                "evaluated_coalitions": len(cache),
            },
        )

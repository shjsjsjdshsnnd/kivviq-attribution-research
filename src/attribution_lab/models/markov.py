from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence

import numpy as np

from attribution_lab.models.base import (
    AttributionModel,
    AttributionResult,
    completed_analysis_journeys,
    normalize_scores,
)
from attribution_lab.schemas.core import Channel, Journey

_START = "__start__"
_CONVERSION = "__conversion__"
_NULL = "__null__"


def _collapse_consecutive(path: list[Channel]) -> list[Channel]:
    collapsed: list[Channel] = []
    for channel in path:
        if not collapsed or collapsed[-1] != channel:
            collapsed.append(channel)
    return collapsed


class MarkovRemovalModel(AttributionModel):
    """First-order path-removal attribution over completed journeys."""

    name = "markov_removal"

    def _paths(self, journeys: Sequence[Journey]) -> list[tuple[list[Channel], bool]]:
        result: list[tuple[list[Channel], bool]] = []
        for journey in completed_analysis_journeys(journeys):
            channels = _collapse_consecutive(
                [touch.channel for touch in journey.attribution_touchpoints()]
            )
            result.append((channels, journey.qualifying_conversion() is not None))
        return result

    @staticmethod
    def _conversion_probability(
        paths: Sequence[tuple[list[Channel], bool]],
        removed: Channel | None = None,
    ) -> float:
        transition_counts: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        states = {_START}
        for path, converted in paths:
            transformed = [channel for channel in path if channel != removed]
            labels = [channel.value for channel in transformed]
            states.update(labels)
            destination = _CONVERSION if converted else _NULL
            chain = [_START, *labels, destination]
            for source, target in zip(chain, chain[1:], strict=True):
                transition_counts[source][target] += 1.0

        transient = sorted(states)
        index = {state: idx for idx, state in enumerate(transient)}
        q = np.zeros((len(transient), len(transient)), dtype=float)
        r = np.zeros(len(transient), dtype=float)

        for source in transient:
            outgoing = transition_counts.get(source, {})
            total = sum(outgoing.values())
            if total <= 0:
                continue
            row = index[source]
            for target, count in outgoing.items():
                probability = count / total
                if target == _CONVERSION:
                    r[row] += probability
                elif target in index:
                    q[row, index[target]] += probability

        matrix = np.eye(len(transient)) - q
        try:
            absorption = np.linalg.solve(matrix, r)
        except np.linalg.LinAlgError:
            absorption = np.linalg.lstsq(matrix, r, rcond=None)[0]
        return float(np.clip(absorption[index[_START]], 0.0, 1.0))

    def attribute(self, journeys: Sequence[Journey]) -> AttributionResult:
        paths = self._paths(journeys)
        present = sorted(
            {channel for path, _ in paths for channel in path},
            key=lambda channel: channel.value,
        )
        base_probability = self._conversion_probability(paths)
        raw_effects = {
            channel: max(
                base_probability - self._conversion_probability(paths, removed=channel),
                0.0,
            )
            for channel in present
        }
        return AttributionResult(
            normalize_scores(raw_effects),
            {
                "model": self.name,
                "base_conversion_probability": base_probability,
                "raw_removal_effects": {
                    channel.value: raw_effects.get(channel, 0.0) for channel in Channel
                },
                "completed_paths": len(paths),
            },
        )

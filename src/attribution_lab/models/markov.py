from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Sequence

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


def _support_diagnostics(paths: Sequence[tuple[list[Channel], bool]]) -> dict[str, float | int]:
    transition_counts: Counter[tuple[str, str]] = Counter()
    path_patterns: Counter[tuple[str, ...]] = Counter()
    for path, converted in paths:
        labels = tuple(channel.value for channel in path)
        path_patterns[labels] += 1
        destination = _CONVERSION if converted else _NULL
        chain = (_START, *labels, destination)
        transition_counts.update(zip(chain, chain[1:], strict=False))

    counts = list(transition_counts.values())
    rare = sum(count <= 2 for count in counts)
    return {
        "unique_path_patterns": len(path_patterns),
        "unique_transitions": len(transition_counts),
        "min_transition_count": min(counts) if counts else 0,
        "rare_transition_count": rare,
        "rare_transition_fraction": rare / len(counts) if counts else 0.0,
        "nonempty_path_fraction": (
            sum(bool(path) for path, _ in paths) / len(paths) if paths else 0.0
        ),
    }


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
            for source, target in zip(chain, chain[1:], strict=False):
                transition_counts[source][target] += 1.0

        transition_probabilities: dict[str, dict[str, float]] = {}
        for source in states:
            outgoing = transition_counts.get(source, {})
            total = sum(outgoing.values())
            transition_probabilities[source] = (
                {target: count / total for target, count in outgoing.items()}
                if total > 0
                else {}
            )

        probabilities = {state: 0.0 for state in states}
        for _ in range(10_000):
            updated: dict[str, float] = {}
            max_change = 0.0
            for state in states:
                probability = 0.0
                for target, weight in transition_probabilities[state].items():
                    if target == _CONVERSION:
                        probability += weight
                    elif target == _NULL:
                        continue
                    else:
                        probability += weight * probabilities[target]
                probability = min(max(probability, 0.0), 1.0)
                updated[state] = probability
                max_change = max(max_change, abs(probability - probabilities[state]))
            probabilities = updated
            if max_change < 1e-12:
                break

        return probabilities[_START]

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
        diagnostics: dict[str, object] = {
            "model": self.name,
            "base_conversion_probability": base_probability,
            "raw_removal_effects": {
                channel.value: raw_effects.get(channel, 0.0) for channel in Channel
            },
            "completed_paths": len(paths),
        }
        diagnostics.update(_support_diagnostics(paths))
        return AttributionResult(normalize_scores(raw_effects), diagnostics)

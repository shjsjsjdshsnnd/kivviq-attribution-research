from __future__ import annotations

from collections.abc import Mapping

from attribution_lab.models.base import AttributionResult
from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.manifest import GroundTruthManifest


def _normalized_positive(values: Mapping[Channel, float]) -> dict[Channel, float]:
    clipped = {channel: max(values.get(channel, 0.0), 0.0) for channel in Channel}
    total = sum(clipped.values())
    if total <= 0:
        return {channel: 0.0 for channel in Channel}
    return {channel: value / total for channel, value in clipped.items()}


def _ranks(values: Mapping[Channel, float]) -> dict[Channel, float]:
    ordered = sorted(Channel, key=lambda channel: (values.get(channel, 0.0), channel.value))
    return {channel: float(rank) for rank, channel in enumerate(ordered, start=1)}


def _pearson(left: Mapping[Channel, float], right: Mapping[Channel, float]) -> float:
    left_values = [left[channel] for channel in Channel]
    right_values = [right[channel] for channel in Channel]
    left_mean = sum(left_values) / len(left_values)
    right_mean = sum(right_values) / len(right_values)
    numerator = sum(
        (a - left_mean) * (b - right_mean)
        for a, b in zip(left_values, right_values, strict=True)
    )
    left_scale = sum((value - left_mean) ** 2 for value in left_values) ** 0.5
    right_scale = sum((value - right_mean) ** 2 for value in right_values) ** 0.5
    denominator = left_scale * right_scale
    return 0.0 if denominator == 0 else numerator / denominator


def evaluate_result(
    result: AttributionResult,
    manifest: GroundTruthManifest,
) -> dict[str, object]:
    """Evaluate descriptive credit only against declared synthetic causal truth."""
    truth_signed = manifest.incremental_effect_map()
    truth = _normalized_positive(truth_signed)
    observed = {channel: result.channel_credit.get(channel, 0.0) for channel in Channel}
    errors = {channel: observed[channel] - truth[channel] for channel in Channel}
    absolute_errors = {channel: abs(value) for channel, value in errors.items()}
    null_channels = [
        channel for channel in Channel if abs(truth_signed.get(channel, 0.0)) < 1e-12
    ]
    return {
        "credit_conservation_error": abs(
            result.total_credit - (1.0 if result.total_credit else 0.0)
        ),
        "rank_agreement": _pearson(_ranks(observed), _ranks(truth)),
        "absolute_attribution_error": sum(absolute_errors.values()),
        "normalized_attribution_error": sum(absolute_errors.values()) / len(Channel),
        "channel_level_bias": {
            channel.value: errors[channel] for channel in Channel
        },
        "false_credit_to_null_channels": sum(observed[channel] for channel in null_channels),
        "synthetic_causal_recovery_l1": sum(absolute_errors.values()),
        "synthetic_truth_signed": {
            channel.value: truth_signed.get(channel, 0.0) for channel in Channel
        },
    }

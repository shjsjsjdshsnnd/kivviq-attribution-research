from __future__ import annotations

import hashlib
import math
import random
from datetime import datetime

from phase2_candidate_sdk import CandidateResponse, DeclaredContext, ObservableDataset

L2_PENALTY = 1.0
MAX_NEWTON_ITERATIONS = 40
COEFFICIENT_TOLERANCE = 1e-8
PROBABILITY_CLIP = 1e-6
BOOTSTRAP_REPLICATIONS = 32


def _sigmoid(value: float) -> float:
    if value >= 0:
        exponent = math.exp(-value)
        return 1.0 / (1.0 + exponent)
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    size = len(vector)
    augmented = [
        [*matrix[row], vector[row]]
        for row in range(size)
    ]
    for column in range(size):
        pivot = max(
            range(column, size),
            key=lambda row: abs(augmented[row][column]),
        )
        if abs(augmented[pivot][column]) < 1e-10:
            augmented[pivot][column] += 1e-6
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        if abs(divisor) < 1e-12:
            divisor = 1e-12 if divisor >= 0 else -1e-12
        for item in range(column, size + 1):
            augmented[column][item] /= divisor
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            if factor == 0.0:
                continue
            for item in range(column, size + 1):
                augmented[row][item] -= factor * augmented[column][item]
    return [augmented[row][size] for row in range(size)]


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


def _fit_logistic(
    features: list[list[float]],
    outcomes: list[float],
) -> tuple[list[float], bool]:
    if not features:
        return [], False
    width = len(features[0])
    coefficients = [0.0] * width
    converged = False

    for _ in range(MAX_NEWTON_ITERATIONS):
        gradient = [0.0] * width
        information = [[0.0] * width for _ in range(width)]
        for row, outcome in zip(features, outcomes, strict=True):
            probability = min(
                max(_sigmoid(_dot(coefficients, row)), PROBABILITY_CLIP),
                1.0 - PROBABILITY_CLIP,
            )
            residual = outcome - probability
            weight = probability * (1.0 - probability)
            for left in range(width):
                gradient[left] += row[left] * residual
                for right in range(width):
                    information[left][right] += weight * row[left] * row[right]

        for index in range(width):
            penalty = 1e-6 if index == 0 else L2_PENALTY
            gradient[index] -= penalty * coefficients[index]
            information[index][index] += penalty

        step = _solve(information, gradient)
        coefficients = [
            coefficient + delta
            for coefficient, delta in zip(coefficients, step, strict=True)
        ]
        if max(abs(delta) for delta in step) < COEFFICIENT_TOLERANCE:
            converged = True
            break

    return coefficients, converged


def _qualifying_conversion(journey) -> bool:
    if journey.conversion is None:
        return False
    start = datetime.fromisoformat(journey.observation_start)
    end = datetime.fromisoformat(journey.observation_end)
    converted = datetime.fromisoformat(journey.conversion.timestamp)
    return start <= converted < end


def _ordered_eligible_channels(journey) -> set[str]:
    start = datetime.fromisoformat(journey.observation_start)
    end = datetime.fromisoformat(journey.observation_end)
    boundary = (
        datetime.fromisoformat(journey.conversion.timestamp)
        if _qualifying_conversion(journey)
        else end
    )
    return {
        touch.channel
        for session in journey.sessions
        for touch in session.touchpoints
        if start <= datetime.fromisoformat(touch.timestamp) < boundary
    }


def _analysis_rows(
    dataset: ObservableDataset,
) -> tuple[list[str], list[list[float]], list[float]]:
    eligible = [
        journey
        for journey in dataset.journeys
        if not journey.is_censored and journey.consent_state != "denied"
    ]
    channels = sorted(
        {
            channel
            for journey in eligible
            for channel in _ordered_eligible_channels(journey)
        }
    )
    rows: list[list[float]] = []
    outcomes: list[float] = []
    for journey in eligible:
        exposures = _ordered_eligible_channels(journey)
        start = datetime.fromisoformat(journey.observation_start)
        end = datetime.fromisoformat(journey.observation_end)
        duration_days = max((end - start).total_seconds() / 86400.0, 0.0)
        row = [
            1.0,
            *[1.0 if channel in exposures else 0.0 for channel in channels],
            float(journey.identity_confidence),
            min(duration_days / 21.0, 2.0),
        ]
        rows.append(row)
        outcomes.append(1.0 if _qualifying_conversion(journey) else 0.0)
    return channels, rows, outcomes


def _gcompute(
    coefficients: list[float],
    rows: list[list[float]],
    channels: list[str],
) -> dict[str, float]:
    if not rows or not coefficients:
        return {channel: 0.0 for channel in channels}
    estimates: dict[str, float] = {}
    for channel_index, channel in enumerate(channels):
        feature_index = 1 + channel_index
        differences: list[float] = []
        for row in rows:
            treated = list(row)
            untreated = list(row)
            treated[feature_index] = 1.0
            untreated[feature_index] = 0.0
            treated_probability = _sigmoid(_dot(coefficients, treated))
            untreated_probability = _sigmoid(_dot(coefficients, untreated))
            differences.append(treated_probability - untreated_probability)
        estimates[channel] = sum(differences) / len(differences)
    return estimates


def _percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * probability
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def _bootstrap_seed(context: DeclaredContext) -> int:
    payload = (
        f"candidate1-v1|{context.stage}|{context.scenario_family}|"
        f"{context.protocol_version}"
    )
    digest = hashlib.sha256(payload.encode()).digest()
    return int.from_bytes(digest[:8], "big")


def estimate(
    dataset: ObservableDataset,
    context: DeclaredContext,
) -> CandidateResponse:
    channels, rows, outcomes = _analysis_rows(dataset)
    if not rows or not channels:
        return CandidateResponse.from_mappings(
            {},
            uncertainty_method="deterministic-subject-bootstrap-percentile-95",
            lower={},
            upper={},
            replications=BOOTSTRAP_REPLICATIONS,
            diagnostics={
                "analyzed_subjects": str(len(rows)),
                "converged": "false",
                "reason": "no analyzable rows or channel support",
            },
        )

    coefficients, converged = _fit_logistic(rows, outcomes)
    point_estimates = _gcompute(coefficients, rows, channels)

    rng = random.Random(_bootstrap_seed(context))
    bootstrap_estimates = {channel: [] for channel in channels}
    for _ in range(BOOTSTRAP_REPLICATIONS):
        indices = [rng.randrange(len(rows)) for _ in rows]
        sample_rows = [rows[index] for index in indices]
        sample_outcomes = [outcomes[index] for index in indices]
        sample_coefficients, _ = _fit_logistic(sample_rows, sample_outcomes)
        sample_effects = _gcompute(sample_coefficients, rows, channels)
        for channel in channels:
            bootstrap_estimates[channel].append(sample_effects[channel])

    lower: dict[str, float] = {}
    upper: dict[str, float] = {}
    for channel in channels:
        low = _percentile(bootstrap_estimates[channel], 0.025)
        high = _percentile(bootstrap_estimates[channel], 0.975)
        point = point_estimates[channel]
        lower[channel] = min(low, point)
        upper[channel] = max(high, point)

    return CandidateResponse.from_mappings(
        point_estimates,
        uncertainty_method="deterministic-subject-bootstrap-percentile-95",
        lower=lower,
        upper=upper,
        replications=BOOTSTRAP_REPLICATIONS,
        diagnostics={
            "analyzed_subjects": str(len(rows)),
            "channel_count": str(len(channels)),
            "converged": str(converged).lower(),
            "model": "l2-logistic-main-effects-gcomputation",
        },
    )

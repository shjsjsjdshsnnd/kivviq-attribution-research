from __future__ import annotations

import math
from datetime import datetime

from phase2_candidate_sdk import CandidateResponse

RIDGE_LAMBDA = 1.0
MAX_ITERATIONS = 60
CONVERGENCE_TOLERANCE = 1e-8
WALD_Z_90 = 1.6448536269514722


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
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            raise ValueError("candidate logistic system is numerically singular")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            if factor == 0.0:
                continue
            augmented[row] = [
                left - factor * right
                for left, right in zip(
                    augmented[row],
                    augmented[column],
                    strict=True,
                )
            ]
    return [augmented[row][-1] for row in range(size)]


def _inverse(matrix: list[list[float]]) -> list[list[float]]:
    size = len(matrix)
    columns: list[list[float]] = []
    for column in range(size):
        unit = [0.0] * size
        unit[column] = 1.0
        columns.append(_solve(matrix, unit))
    return [
        [columns[column][row] for column in range(size)]
        for row in range(size)
    ]


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


def _visible_channels(dataset) -> list[str]:
    return sorted(
        {
            touch.channel
            for journey in dataset.journeys
            if journey.consent_state != "denied"
            for session in journey.sessions
            for touch in session.touchpoints
        }
    )


def _duration_fraction(journey) -> float:
    start = datetime.fromisoformat(journey.observation_start)
    end = datetime.fromisoformat(journey.observation_end)
    hours = max((end - start).total_seconds() / 3600.0, 0.0)
    return min(hours / (24.0 * 21.0), 1.5)


def _prepare(dataset, channels: list[str]) -> tuple[list[list[float]], list[float]]:
    rows: list[list[float]] = []
    outcomes: list[float] = []
    for journey in dataset.journeys:
        visible = journey.consent_state != "denied"
        exposed = (
            {
                touch.channel
                for session in journey.sessions
                for touch in session.touchpoints
            }
            if visible
            else set()
        )
        treatment = [1.0 if channel in exposed else 0.0 for channel in channels]
        measurement = [
            float(journey.identity_confidence),
            1.0 if visible else 0.0,
            0.0 if journey.is_censored else 1.0,
            _duration_fraction(journey),
        ]
        rows.append([1.0, *treatment, *measurement])
        outcomes.append(1.0 if journey.conversion is not None else 0.0)
    return rows, outcomes


def _information(
    rows: list[list[float]],
    beta: list[float],
    ridge: float,
) -> list[list[float]]:
    size = len(beta)
    matrix = [[0.0] * size for _ in range(size)]
    for row in rows:
        probability = _sigmoid(_dot(row, beta))
        weight = max(probability * (1.0 - probability), 1e-8)
        for left in range(size):
            for right in range(size):
                matrix[left][right] += weight * row[left] * row[right]
    for index in range(1, size):
        matrix[index][index] += ridge
    matrix[0][0] += 1e-9
    return matrix


def _fit(
    rows: list[list[float]],
    outcomes: list[float],
    ridge: float,
) -> tuple[list[float], list[list[float]], bool]:
    if not rows:
        raise ValueError("candidate requires at least one observed subject")
    size = len(rows[0])
    beta = [0.0] * size
    converged = False
    for _ in range(MAX_ITERATIONS):
        gradient = [0.0] * size
        for row, outcome in zip(rows, outcomes, strict=True):
            probability = _sigmoid(_dot(row, beta))
            residual = outcome - probability
            for index in range(size):
                gradient[index] += row[index] * residual
        for index in range(1, size):
            gradient[index] -= ridge * beta[index]

        information = _information(rows, beta, ridge)
        step = _solve(information, gradient)
        largest = max(abs(value) for value in step)
        if largest > 2.0:
            scale = 2.0 / largest
            step = [value * scale for value in step]
        beta = [value + delta for value, delta in zip(beta, step, strict=True)]
        if max(abs(value) for value in step) < CONVERGENCE_TOLERANCE:
            converged = True
            break

    covariance = _inverse(_information(rows, beta, ridge))
    return beta, covariance, converged


def _effect_and_gradient(
    rows: list[list[float]],
    beta: list[float],
    channel_index: int,
) -> tuple[float, list[float]]:
    contrast_sum = 0.0
    gradient = [0.0] * len(beta)
    feature_index = 1 + channel_index

    for original in rows:
        treated = list(original)
        untreated = list(original)
        treated[feature_index] = 1.0
        untreated[feature_index] = 0.0
        p_treated = _sigmoid(_dot(treated, beta))
        p_untreated = _sigmoid(_dot(untreated, beta))
        contrast_sum += p_treated - p_untreated
        for index in range(len(beta)):
            gradient[index] += (
                p_treated * (1.0 - p_treated) * treated[index]
                - p_untreated * (1.0 - p_untreated) * untreated[index]
            )

    denominator = len(rows)
    return (
        contrast_sum / denominator,
        [value / denominator for value in gradient],
    )


def _quadratic(
    vector: list[float],
    matrix: list[list[float]],
) -> float:
    return sum(
        vector[row]
        * sum(matrix[row][column] * vector[column] for column in range(len(vector)))
        for row in range(len(vector))
    )


def estimate(dataset, context):
    channels = _visible_channels(dataset)
    if not channels:
        raise ValueError("candidate requires at least one observable synthetic channel")
    rows, outcomes = _prepare(dataset, channels)
    beta, covariance, converged = _fit(rows, outcomes, RIDGE_LAMBDA)

    estimates: dict[str, float] = {}
    lower: dict[str, float] = {}
    upper: dict[str, float] = {}
    for channel_index, channel in enumerate(channels):
        effect, gradient = _effect_and_gradient(rows, beta, channel_index)
        variance = max(_quadratic(gradient, covariance), 0.0)
        standard_error = math.sqrt(variance)
        estimates[channel] = effect
        lower[channel] = max(-1.0, effect - WALD_Z_90 * standard_error)
        upper[channel] = min(1.0, effect + WALD_Z_90 * standard_error)

    return CandidateResponse.from_mappings(
        estimates,
        uncertainty_method="approximate-90pct-wald-delta",
        lower=lower,
        upper=upper,
        replications=1,
        diagnostics={
            "candidate": "candidate1-outcome-regression-gcomp",
            "ridge_lambda": str(RIDGE_LAMBDA),
            "rows": str(len(rows)),
            "channels": str(len(channels)),
            "converged": str(converged).lower(),
            "stage": context.stage,
        },
    )

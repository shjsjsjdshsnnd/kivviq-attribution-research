from __future__ import annotations

import math
from datetime import datetime

from phase2_candidate_sdk import (
    CandidateResponse,
    DeclaredContext,
    ObservableDataset,
    ObservableJourney,
)

RIDGE_LAMBDA = 1e-4
Z_95 = 1.959963984540054


def _channels(dataset: ObservableDataset) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                touch.channel
                for journey in dataset.journeys
                for session in journey.sessions
                for touch in session.touchpoints
            }
        )
    )


def _presence(journey: ObservableJourney) -> set[str]:
    sessions = journey.sessions
    return {
        touch.channel
        for session in sessions
        for touch in session.touchpoints
    }


def _window_fraction(journey: ObservableJourney) -> float:
    start = datetime.fromisoformat(journey.observation_start)
    end = datetime.fromisoformat(journey.observation_end)
    hours = max((end - start).total_seconds() / 3600.0, 0.0)
    return min(hours / (24.0 * 21.0), 1.5)


def _invert(matrix: list[list[float]]) -> list[list[float]]:
    size = len(matrix)
    augmented = [
        row[:] + [1.0 if row_index == col_index else 0.0 for col_index in range(size)]
        for row_index, row in enumerate(matrix)
    ]
    for column in range(size):
        pivot_row = max(
            range(column, size),
            key=lambda row_index: abs(augmented[row_index][column]),
        )
        pivot = augmented[pivot_row][column]
        if abs(pivot) < 1e-12:
            raise ValueError("candidate design matrix is singular after stabilization")
        augmented[column], augmented[pivot_row] = (
            augmented[pivot_row],
            augmented[column],
        )
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row_index in range(size):
            if row_index == column:
                continue
            factor = augmented[row_index][column]
            if factor == 0.0:
                continue
            augmented[row_index] = [
                value - factor * pivot_value
                for value, pivot_value in zip(
                    augmented[row_index],
                    augmented[column],
                    strict=True,
                )
            ]
    return [row[size:] for row in augmented]


def _matvec(matrix: list[list[float]], vector: list[float]) -> list[float]:
    return [
        sum(value * weight for value, weight in zip(row, vector, strict=True))
        for row in matrix
    ]


def _matmul(
    left: list[list[float]],
    right: list[list[float]],
) -> list[list[float]]:
    right_t = list(map(list, zip(*right, strict=True)))
    return [
        [
            sum(a * b for a, b in zip(left_row, right_col, strict=True))
            for right_col in right_t
        ]
        for left_row in left
    ]


def _transpose(matrix: list[list[float]]) -> list[list[float]]:
    return list(map(list, zip(*matrix, strict=True)))


def _fit_target(
    dataset: ObservableDataset,
    target: str,
    channels: tuple[str, ...],
) -> tuple[float, float, float, dict[str, str]]:
    others = tuple(channel for channel in channels if channel != target)
    rows: list[list[float]] = []
    outcomes: list[float] = []
    treated = 0

    for journey in dataset.journeys:
        present = _presence(journey)
        treatment = 1.0 if target in present else 0.0
        treated += int(treatment)
        row = [
            1.0,
            treatment,
            *[1.0 if channel in present else 0.0 for channel in others],
            float(journey.identity_confidence),
            1.0 if journey.is_censored else 0.0,
            _window_fraction(journey),
        ]
        rows.append(row)
        outcomes.append(1.0 if journey.conversion is not None else 0.0)

    if not rows:
        return 0.0, -1.0, 1.0, {
            "n": "0",
            "treated_fraction": "0.000000",
            "design_columns": "0",
        }

    n = len(rows)
    p = len(rows[0])
    xt = _transpose(rows)
    xtx = _matmul(xt, rows)
    for index in range(1, p):
        xtx[index][index] += RIDGE_LAMBDA
    xty = [
        sum(value * outcome for value, outcome in zip(column, outcomes, strict=True))
        for column in xt
    ]
    inverse = _invert(xtx)
    beta = _matvec(inverse, xty)
    estimate = beta[1]

    residuals = [
        outcome
        - sum(value * coefficient for value, coefficient in zip(row, beta, strict=True))
        for row, outcome in zip(rows, outcomes, strict=True)
    ]
    meat = [[0.0 for _ in range(p)] for _ in range(p)]
    for row, residual in zip(rows, residuals, strict=True):
        squared = residual * residual
        for left_index in range(p):
            for right_index in range(p):
                meat[left_index][right_index] += (
                    squared * row[left_index] * row[right_index]
                )
    covariance = _matmul(_matmul(inverse, meat), inverse)
    scale = n / max(n - p, 1)
    variance = max(covariance[1][1] * scale, 0.0)
    standard_error = math.sqrt(variance)
    lower = estimate - Z_95 * standard_error
    upper = estimate + Z_95 * standard_error

    if not all(math.isfinite(value) for value in (estimate, lower, upper)):
        raise ValueError("candidate produced non-finite treatment estimate")

    diagnostics = {
        "n": str(n),
        "treated_fraction": f"{treated / n:.6f}",
        "design_columns": str(p),
        "ridge_lambda": f"{RIDGE_LAMBDA:.8f}",
    }
    return estimate, lower, upper, diagnostics


def estimate(
    dataset: ObservableDataset,
    context: DeclaredContext,
) -> CandidateResponse:
    channels = _channels(dataset)
    estimates: dict[str, float] = {}
    lower: dict[str, float] = {}
    upper: dict[str, float] = {}
    diagnostics: dict[str, str] = {
        "candidate_method": "ridge_lpm_hc1",
        "stage": context.stage,
    }

    for channel in channels:
        point, low, high, channel_diagnostics = _fit_target(dataset, channel, channels)
        estimates[channel] = point
        lower[channel] = low
        upper[channel] = high
        diagnostics.update(
            {
                f"{channel}:{key}": value
                for key, value in channel_diagnostics.items()
            }
        )

    return CandidateResponse.from_mappings(
        estimates,
        uncertainty_method="HC1 robust 95% interval",
        lower=lower,
        upper=upper,
        replications=1,
        diagnostics=diagnostics,
    )

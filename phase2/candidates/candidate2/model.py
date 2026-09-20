from __future__ import annotations

import json
import math
from datetime import datetime

import numpy as np

from phase2_candidate_sdk import CandidateResponse

OUTCOME_L2 = 5.0
PROPENSITY_L2 = 5.0
PROPENSITY_CLIP_LOWER = 0.025
PROPENSITY_CLIP_UPPER = 0.975
MAX_ITERATIONS = 60
CONVERGENCE_TOLERANCE = 1e-8
Z_90 = 1.6448536269514722


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


def _normalized_position(timestamp: str, start: str, end: str) -> float:
    point = datetime.fromisoformat(timestamp)
    left = datetime.fromisoformat(start)
    right = datetime.fromisoformat(end)
    duration = max((right - left).total_seconds(), 1.0)
    return min(max((point - left).total_seconds() / duration, 0.0), 1.0)


def _subject_row(journey, channels: list[str], focal: str) -> tuple[float, float, list[float]]:
    visible = journey.consent_state != "denied"
    touches = [
        touch
        for session in journey.sessions
        for touch in session.touchpoints
    ] if visible else []
    treatment = 1.0 if any(touch.channel == focal for touch in touches) else 0.0
    non_focal = [touch for touch in touches if touch.channel != focal]
    non_focal_sessions = sum(
        int(any(touch.channel != focal for touch in session.touchpoints))
        for session in journey.sessions
    ) if visible else 0

    other_indicators = [
        1.0 if any(touch.channel == channel for touch in non_focal) else 0.0
        for channel in channels
        if channel != focal
    ]
    if non_focal:
        positions = [
            _normalized_position(
                touch.timestamp,
                journey.observation_start,
                journey.observation_end,
            )
            for touch in non_focal
        ]
        earliest = min(positions)
        latest = max(positions)
    else:
        earliest = 0.0
        latest = 0.0

    history = [
        math.log1p(len(non_focal)) / 3.0,
        math.log1p(non_focal_sessions) / 2.0,
        earliest,
        latest,
        float(journey.identity_confidence),
        1.0 if visible else 0.0,
        0.0 if journey.is_censored else 1.0,
    ]
    outcome = 1.0 if journey.conversion is not None else 0.0
    return treatment, outcome, [*other_indicators, *history]


def _sigmoid(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, -35.0, 35.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def _fit_logistic(
    matrix: np.ndarray,
    outcome: np.ndarray,
    l2: float,
) -> tuple[np.ndarray, bool]:
    if matrix.shape[0] == 0:
        raise ValueError("candidate nuisance model requires observations")
    beta = np.zeros(matrix.shape[1], dtype=float)
    penalty = np.ones(matrix.shape[1], dtype=float)
    penalty[0] = 0.0
    converged = False
    for _ in range(MAX_ITERATIONS):
        probability = _sigmoid(matrix @ beta)
        weight = np.clip(probability * (1.0 - probability), 1e-6, None)
        gradient = matrix.T @ (outcome - probability) - l2 * penalty * beta
        information = matrix.T @ (weight[:, None] * matrix)
        information += np.diag(l2 * penalty + 1e-9)
        try:
            step = np.linalg.solve(information, gradient)
        except np.linalg.LinAlgError:
            step = np.linalg.lstsq(information, gradient, rcond=None)[0]
        largest = float(np.max(np.abs(step)))
        if largest > 2.0:
            step *= 2.0 / largest
        beta += step
        if float(np.max(np.abs(step))) < CONVERGENCE_TOLERANCE:
            converged = True
            break
    return beta, converged


def _effective_sample_size(weights: np.ndarray) -> float:
    if weights.size == 0:
        return 0.0
    denominator = float(np.sum(weights * weights))
    if denominator <= 0.0:
        return 0.0
    total = float(np.sum(weights))
    return total * total / denominator


def _channel_estimate(dataset, channels: list[str], focal: str) -> tuple[dict[str, float], dict[str, float]]:
    prepared = [_subject_row(journey, channels, focal) for journey in dataset.journeys]
    treatment = np.asarray([row[0] for row in prepared], dtype=float)
    outcome = np.asarray([row[1] for row in prepared], dtype=float)
    confounders = np.asarray([row[2] for row in prepared], dtype=float)
    if confounders.ndim != 2 or confounders.shape[0] < 3:
        raise ValueError("candidate requires at least three observable subjects")

    treated_count = int(np.sum(treatment))
    control_count = int(treatment.size - treated_count)
    if treated_count < 2 or control_count < 2:
        raise ValueError(f"insufficient treatment support for {focal}")

    intercept = np.ones((confounders.shape[0], 1), dtype=float)
    propensity_matrix = np.hstack([intercept, confounders])
    propensity_beta, propensity_converged = _fit_logistic(
        propensity_matrix,
        treatment,
        PROPENSITY_L2,
    )
    raw_propensity = _sigmoid(propensity_matrix @ propensity_beta)
    propensity = np.clip(
        raw_propensity,
        PROPENSITY_CLIP_LOWER,
        PROPENSITY_CLIP_UPPER,
    )

    outcome_matrix = np.hstack([intercept, treatment[:, None], confounders])
    outcome_beta, outcome_converged = _fit_logistic(
        outcome_matrix,
        outcome,
        OUTCOME_L2,
    )
    treated_matrix = outcome_matrix.copy()
    untreated_matrix = outcome_matrix.copy()
    treated_matrix[:, 1] = 1.0
    untreated_matrix[:, 1] = 0.0
    m1 = _sigmoid(treated_matrix @ outcome_beta)
    m0 = _sigmoid(untreated_matrix @ outcome_beta)

    pseudo = (
        m1
        - m0
        + treatment * (outcome - m1) / propensity
        - (1.0 - treatment) * (outcome - m0) / (1.0 - propensity)
    )
    effect = float(np.mean(pseudo))
    if pseudo.size > 1:
        standard_error = float(np.std(pseudo, ddof=1) / math.sqrt(pseudo.size))
    else:
        standard_error = float("inf")

    treated_weights = 1.0 / propensity[treatment == 1.0]
    control_weights = 1.0 / (1.0 - propensity[treatment == 0.0])
    extreme = np.logical_or(
        raw_propensity < PROPENSITY_CLIP_LOWER,
        raw_propensity > PROPENSITY_CLIP_UPPER,
    )
    quantiles = np.quantile(
        raw_propensity,
        [0.0, 0.01, 0.05, 0.5, 0.95, 0.99, 1.0],
    )

    metrics = {
        "effect": effect,
        "lower": max(-1.0, effect - Z_90 * standard_error),
        "upper": min(1.0, effect + Z_90 * standard_error),
    }
    diagnostics = {
        "treatment_prevalence": float(np.mean(treatment)),
        "raw_propensity_min": float(quantiles[0]),
        "raw_propensity_p01": float(quantiles[1]),
        "raw_propensity_p05": float(quantiles[2]),
        "raw_propensity_median": float(quantiles[3]),
        "raw_propensity_p95": float(quantiles[4]),
        "raw_propensity_p99": float(quantiles[5]),
        "raw_propensity_max": float(quantiles[6]),
        "extreme_raw_propensity_fraction": float(np.mean(extreme)),
        "treated_ess": _effective_sample_size(treated_weights),
        "control_ess": _effective_sample_size(control_weights),
        "maximum_inverse_weight": max(
            float(np.max(treated_weights)),
            float(np.max(control_weights)),
        ),
        "outcome_converged": float(outcome_converged),
        "propensity_converged": float(propensity_converged),
        "treated_count": float(treated_count),
        "control_count": float(control_count),
    }
    return metrics, diagnostics


def estimate(dataset, context):
    channels = _visible_channels(dataset)
    if not channels:
        raise ValueError("candidate requires observable synthetic channels")

    estimates: dict[str, float] = {}
    lower: dict[str, float] = {}
    upper: dict[str, float] = {}
    diagnostics_by_channel: dict[str, dict[str, float]] = {}
    unsupported: list[str] = []

    for channel in channels:
        try:
            metrics, diagnostics = _channel_estimate(dataset, channels, channel)
        except ValueError:
            unsupported.append(channel)
            continue
        estimates[channel] = metrics["effect"]
        lower[channel] = metrics["lower"]
        upper[channel] = metrics["upper"]
        diagnostics_by_channel[channel] = diagnostics

    if not estimates:
        raise ValueError("candidate has no channel with sufficient treatment support")

    return CandidateResponse.from_mappings(
        estimates,
        uncertainty_method="aipw-influence-normal-90pct",
        lower=lower,
        upper=upper,
        replications=1,
        diagnostics={
            "candidate": "candidate2-aipw-dr-observable",
            "outcome_l2": str(OUTCOME_L2),
            "propensity_l2": str(PROPENSITY_L2),
            "propensity_clip": f"{PROPENSITY_CLIP_LOWER}:{PROPENSITY_CLIP_UPPER}",
            "overlap_json": json.dumps(
                diagnostics_by_channel,
                sort_keys=True,
                separators=(",", ":"),
            ),
            "unsupported_channels_json": json.dumps(sorted(unsupported)),
            "stage": context.stage,
        },
    )

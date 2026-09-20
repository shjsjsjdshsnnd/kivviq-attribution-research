from __future__ import annotations

import math
from datetime import datetime

from phase2_candidate_sdk import CandidateResponse

RIDGE = 0.02
ITERATIONS = 500
LEARNING_RATE = 0.15
PROPENSITY_CLIP = 0.05
Z_95 = 1.96


def _sigmoid(value: float) -> float:
    if value >= 35.0:
        return 1.0
    if value <= -35.0:
        return 0.0
    return 1.0 / (1.0 + math.exp(-value))


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


def _fit_logistic(rows: list[list[float]], labels: list[float]) -> list[float]:
    if not rows:
        return [0.0]
    width = len(rows[0])
    beta = [0.0] * width
    count = float(len(rows))
    for _ in range(ITERATIONS):
        gradient = [0.0] * width
        for row, label in zip(rows, labels, strict=True):
            probability = _sigmoid(_dot(beta, row))
            residual = probability - label
            for index, value in enumerate(row):
                gradient[index] += residual * value
        for index in range(width):
            penalty = 0.0 if index == 0 else RIDGE * beta[index]
            beta[index] -= LEARNING_RATE * (gradient[index] / count + penalty)
    return beta


def _predict(beta: list[float], row: list[float]) -> float:
    return _sigmoid(_dot(beta, row))


def _pre_outcome_channels(journey) -> set[str]:
    boundary = None
    if journey.conversion is not None:
        boundary = datetime.fromisoformat(journey.conversion.timestamp)
    channels: set[str] = set()
    for session in journey.sessions:
        for touch in session.touchpoints:
            timestamp = datetime.fromisoformat(touch.timestamp)
            if boundary is None or timestamp < boundary:
                channels.add(touch.channel)
    return channels


def _eligible_rows(dataset):
    rows = []
    for journey in dataset.journeys:
        if journey.is_censored or journey.consent_state == "denied":
            continue
        channels = _pre_outcome_channels(journey)
        outcome = 1.0 if journey.conversion is not None else 0.0
        rows.append((channels, outcome))
    return rows


def _estimate_channel(
    focal: str,
    channels: list[str],
    subjects,
) -> tuple[float, float, float, int, int]:
    others = [channel for channel in channels if channel != focal]
    features: list[list[float]] = []
    treatment: list[float] = []
    outcome: list[float] = []
    for exposure_set, converted in subjects:
        features.append([1.0, *[1.0 if channel in exposure_set else 0.0 for channel in others]])
        treatment.append(1.0 if focal in exposure_set else 0.0)
        outcome.append(converted)

    treated_count = int(sum(treatment))
    control_count = len(treatment) - treated_count
    propensity_beta = _fit_logistic(features, treatment)

    treated_features = [
        row for row, assigned in zip(features, treatment, strict=True) if assigned == 1.0
    ]
    treated_outcomes = [
        value for value, assigned in zip(outcome, treatment, strict=True) if assigned == 1.0
    ]
    control_features = [
        row for row, assigned in zip(features, treatment, strict=True) if assigned == 0.0
    ]
    control_outcomes = [
        value for value, assigned in zip(outcome, treatment, strict=True) if assigned == 0.0
    ]
    outcome_treated_beta = _fit_logistic(treated_features, treated_outcomes)
    outcome_control_beta = _fit_logistic(control_features, control_outcomes)

    pseudo_outcomes: list[float] = []
    for row, assigned, converted in zip(features, treatment, outcome, strict=True):
        propensity = min(
            max(_predict(propensity_beta, row), PROPENSITY_CLIP),
            1.0 - PROPENSITY_CLIP,
        )
        mean_treated = _predict(outcome_treated_beta, row)
        mean_control = _predict(outcome_control_beta, row)
        pseudo = (
            mean_treated
            - mean_control
            + assigned * (converted - mean_treated) / propensity
            - (1.0 - assigned) * (converted - mean_control) / (1.0 - propensity)
        )
        pseudo_outcomes.append(pseudo)

    if not pseudo_outcomes:
        return 0.0, -1.0, 1.0, treated_count, control_count

    raw_effect = sum(pseudo_outcomes) / len(pseudo_outcomes)
    effect = min(max(raw_effect, -1.0), 1.0)
    if len(pseudo_outcomes) <= 1:
        standard_error = 1.0
    else:
        variance = sum((value - raw_effect) ** 2 for value in pseudo_outcomes) / (
            len(pseudo_outcomes) - 1
        )
        standard_error = math.sqrt(max(variance, 0.0) / len(pseudo_outcomes))

    lower = max(-1.0, effect - Z_95 * standard_error)
    upper = min(1.0, effect + Z_95 * standard_error)
    lower = min(lower, effect)
    upper = max(upper, effect)
    return effect, lower, upper, treated_count, control_count


def estimate(dataset, context):
    subjects = _eligible_rows(dataset)
    channels = sorted({channel for exposure_set, _ in subjects for channel in exposure_set})
    if not channels:
        return CandidateResponse.from_mappings(
            {},
            uncertainty_method="aipw-influence-normal-95",
            lower={},
            upper={},
            diagnostics={"eligible_subjects": str(len(subjects)), "stage": context.stage},
        )

    estimates: dict[str, float] = {}
    lower: dict[str, float] = {}
    upper: dict[str, float] = {}
    minimum_treated = len(subjects)
    minimum_control = len(subjects)
    for channel in channels:
        effect, low, high, treated, control = _estimate_channel(channel, channels, subjects)
        estimates[channel] = effect
        lower[channel] = low
        upper[channel] = high
        minimum_treated = min(minimum_treated, treated)
        minimum_control = min(minimum_control, control)

    return CandidateResponse.from_mappings(
        estimates,
        uncertainty_method="aipw-influence-normal-95",
        lower=lower,
        upper=upper,
        replications=len(subjects),
        diagnostics={
            "estimator": "aipw-ridge-logistic",
            "eligible_subjects": str(len(subjects)),
            "minimum_treated": str(minimum_treated),
            "minimum_control": str(minimum_control),
            "propensity_clip": str(PROPENSITY_CLIP),
            "stage": context.stage,
        },
    )

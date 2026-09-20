from __future__ import annotations

import hashlib
import math
import random
from datetime import datetime
from typing import Any

from phase2_candidate_sdk import CandidateResponse

CANDIDATE_ID = "phase2-candidate1-ipw"
CANDIDATE_VERSION = "1.0.0"

# DEVELOPMENT may substitute only these two preregistered values.
PROPENSITY_L2 = 0.50
PROPENSITY_CLIP = 0.10

GRADIENT_STEPS = 300
LEARNING_RATE = 0.05
BOOTSTRAP_REPS = 200
MIN_GROUP_SIZE = 8

Row = tuple[list[float], int, int]


def _eligible_journeys(dataset: Any) -> tuple[Any, ...]:
    return tuple(
        journey
        for journey in dataset.journeys
        if journey.consent_state != "denied" and not journey.is_censored
    )


def _touches_before_outcome(journey: Any) -> tuple[Any, ...]:
    boundary = (
        datetime.fromisoformat(journey.conversion.timestamp)
        if journey.conversion is not None
        else datetime.fromisoformat(journey.observation_end)
    )
    touches = []
    for session in journey.sessions:
        for touch in session.touchpoints:
            if datetime.fromisoformat(touch.timestamp) < boundary:
                touches.append(touch)
    touches.sort(key=lambda touch: (touch.timestamp, touch.event_id))
    return tuple(touches)


def _channel_universe(journeys: tuple[Any, ...]) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                touch.channel
                for journey in journeys
                for touch in _touches_before_outcome(journey)
            }
        )
    )


def _normalized_time(journey: Any, timestamp: str) -> float:
    start = datetime.fromisoformat(journey.observation_start)
    end = datetime.fromisoformat(journey.observation_end)
    moment = datetime.fromisoformat(timestamp)
    denominator = max((end - start).total_seconds(), 1.0)
    return min(max((moment - start).total_seconds() / denominator, 0.0), 1.0)


def _features(journey: Any, target: str, universe: tuple[str, ...]) -> list[float]:
    touches = _touches_before_outcome(journey)
    other = [touch for touch in touches if touch.channel != target]
    other_channels = {touch.channel for touch in other}
    features = [1.0]
    features.extend(
        1.0 if channel in other_channels else 0.0
        for channel in universe
        if channel != target
    )
    features.append(len(other_channels) / max(len(universe) - 1, 1))
    features.append(min(len(other), 10) / 10.0)
    features.append(min(len(journey.sessions), 10) / 10.0)
    if other:
        features.append(_normalized_time(journey, other[0].timestamp))
        features.append(_normalized_time(journey, other[-1].timestamp))
    else:
        features.extend((0.0, 0.0))
    features.append(float(journey.identity_confidence))
    return features


def _sigmoid(value: float) -> float:
    if value >= 0:
        exponent = math.exp(-value)
        return 1.0 / (1.0 + exponent)
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right, strict=True))


def _fit_propensity(rows: list[Row], l2: float) -> list[float]:
    feature_count = len(rows[0][0])
    coefficients = [0.0] * feature_count
    denominator = float(len(rows))
    for step in range(GRADIENT_STEPS):
        gradient = [0.0] * feature_count
        for features, treatment, _ in rows:
            probability = _sigmoid(_dot(coefficients, features))
            error = probability - treatment
            for index, value in enumerate(features):
                gradient[index] += error * value
        rate = LEARNING_RATE / math.sqrt(1.0 + step / 50.0)
        for index in range(feature_count):
            penalty = 0.0 if index == 0 else l2 * coefficients[index]
            coefficients[index] -= rate * (gradient[index] / denominator + penalty)
    return coefficients


def _weighted_effect(
    rows: list[Row],
    propensities: tuple[float, ...],
    clip: float,
) -> tuple[float, tuple[float, ...]]:
    treated_fraction = sum(row[1] for row in rows) / len(rows)
    numerator_treated = 0.0
    denominator_treated = 0.0
    numerator_control = 0.0
    denominator_control = 0.0
    weights = []
    for (_, treatment, outcome), raw_propensity in zip(
        rows, propensities, strict=True
    ):
        propensity = min(max(raw_propensity, clip), 1.0 - clip)
        if treatment:
            weight = treated_fraction / propensity
            numerator_treated += weight * outcome
            denominator_treated += weight
        else:
            weight = (1.0 - treated_fraction) / (1.0 - propensity)
            numerator_control += weight * outcome
            denominator_control += weight
        weights.append(weight)
    if denominator_treated <= 0 or denominator_control <= 0:
        raise ValueError("insufficient weighted support")
    estimate = (
        numerator_treated / denominator_treated
        - numerator_control / denominator_control
    )
    return estimate, tuple(weights)


def _bootstrap_interval(
    rows: list[Row],
    weights: tuple[float, ...],
    target: str,
    replications: int,
) -> tuple[float, float, int]:
    seed_material = f"{CANDIDATE_ID}|{CANDIDATE_VERSION}|{target}".encode()
    seed = int.from_bytes(hashlib.sha256(seed_material).digest()[:8], "big")
    rng = random.Random(seed)
    effects = []
    count = len(rows)
    for _ in range(replications):
        numerator_treated = 0.0
        denominator_treated = 0.0
        numerator_control = 0.0
        denominator_control = 0.0
        for _draw in range(count):
            index = rng.randrange(count)
            _, treatment, outcome = rows[index]
            weight = weights[index]
            if treatment:
                numerator_treated += weight * outcome
                denominator_treated += weight
            else:
                numerator_control += weight * outcome
                denominator_control += weight
        if denominator_treated <= 0 or denominator_control <= 0:
            continue
        effects.append(
            numerator_treated / denominator_treated
            - numerator_control / denominator_control
        )
    if len(effects) < max(20, replications // 2):
        raise ValueError("bootstrap support is insufficient")
    effects.sort()
    lower_index = int(0.05 * (len(effects) - 1))
    upper_index = int(0.95 * (len(effects) - 1))
    return effects[lower_index], effects[upper_index], len(effects)


def _effective_sample_size(weights: tuple[float, ...]) -> float:
    total = sum(weights)
    squared = sum(weight * weight for weight in weights)
    return 0.0 if squared <= 0 else total * total / squared


def estimate(dataset: Any, context: Any) -> CandidateResponse:
    journeys = _eligible_journeys(dataset)
    if len(journeys) < 2 * MIN_GROUP_SIZE:
        raise ValueError("insufficient eligible subjects")

    universe = _channel_universe(journeys)
    if not universe:
        raise ValueError("no observable channel exposure")

    estimates = {}
    lower = {}
    upper = {}
    diagnostics = {}

    for target in universe:
        rows: list[Row] = []
        for journey in journeys:
            touches = _touches_before_outcome(journey)
            treatment = int(any(touch.channel == target for touch in touches))
            outcome = int(journey.conversion is not None)
            rows.append((_features(journey, target, universe), treatment, outcome))

        treated = sum(row[1] for row in rows)
        control = len(rows) - treated
        if treated < MIN_GROUP_SIZE or control < MIN_GROUP_SIZE:
            raise ValueError(f"positivity/support failure for {target}")

        coefficients = _fit_propensity(rows, PROPENSITY_L2)
        propensities = tuple(
            _sigmoid(_dot(coefficients, features))
            for features, _, _ in rows
        )
        point, weights = _weighted_effect(rows, propensities, PROPENSITY_CLIP)
        low, high, completed = _bootstrap_interval(
            rows,
            weights,
            target,
            BOOTSTRAP_REPS,
        )

        estimates[target] = point
        lower[target] = min(low, point)
        upper[target] = max(high, point)
        diagnostics[f"{target}:treated"] = str(treated)
        diagnostics[f"{target}:control"] = str(control)
        diagnostics[f"{target}:propensity_min"] = f"{min(propensities):.6f}"
        diagnostics[f"{target}:propensity_max"] = f"{max(propensities):.6f}"
        diagnostics[f"{target}:effective_n"] = f"{_effective_sample_size(weights):.3f}"
        diagnostics[f"{target}:bootstrap_completed"] = str(completed)

    diagnostics["stage"] = context.stage
    diagnostics["method"] = "stabilized_ipw_logistic_propensity"
    return CandidateResponse.from_mappings(
        estimates,
        uncertainty_method="deterministic-fixed-propensity-subject-bootstrap-90pct",
        lower=lower,
        upper=upper,
        replications=BOOTSTRAP_REPS,
        diagnostics=diagnostics,
    )

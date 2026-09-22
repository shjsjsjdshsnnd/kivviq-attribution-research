"""Evaluator-owned public support calibration; not Candidate 4 policy code."""

from __future__ import annotations

from math import exp
from statistics import mean
from typing import Any

PROTOCOL_VERSION = "candidate4-public-support-calibration-v1"
SAMPLE_SIZES = (80, 250, 5000)
SUPPORT_LEVELS = ("full", "overlap_only", "unsupported", "boundary")
MEASUREMENT_CONDITIONS = ("perfect", "damaged")
LATENT_CONFOUNDING_LEVELS = (0.0, 1.0)
SEEDS = (2026092201, 2026092202)


def _sigmoid(value: float) -> float:
    return 1.0 / (1.0 + exp(-value))


def _support_parameters(level: str) -> tuple[float, float]:
    return {
        "full": (0.0, 0.35),
        "overlap_only": (-1.5, 1.25),
        "unsupported": (-3.2, 2.1),
        "boundary": (-2.0, 1.55),
    }[level]


def _classify(level: str) -> str:
    return {
        "full": "STRUCTURALLY_FULL_POPULATION_SUPPORTED",
        "overlap_only": "STRUCTURALLY_OVERLAP_ONLY",
        "unsupported": "STRUCTURALLY_UNSUPPORTED",
        "boundary": "STRUCTURALLY_OVERLAP_ONLY",
    }[level]


def _record(level: str, n: int, measurement: str, latent: float, seed: int) -> dict[str, Any]:
    intercept, slope = _support_parameters(level)
    covariates = [((index * 37 + seed) % 101) / 50.0 - 1.0 for index in range(n)]
    propensities = [_sigmoid(intercept + slope * value) for value in covariates]
    prevalence = mean(propensities)
    central = sum(0.10 <= value <= 0.90 for value in propensities) / n
    normalized_overlap = 4.0 * mean(value * (1.0 - value) for value in propensities)
    treated_ess = (n * prevalence) * (1.0 - min(0.75, slope / 4.0))
    control_ess = (n * (1.0 - prevalence)) * (1.0 - min(0.75, slope / 4.0))
    damaged = measurement == "damaged"
    observed_central = max(0.0, central - (0.22 if damaged else 0.0))
    finite_sample_limited = n < 250
    structural = _classify(level)
    return {
        "protocol_version": PROTOCOL_VERSION,
        "seed": seed,
        "support_level": level,
        "sample_size": n,
        "measurement_condition": measurement,
        "latent_confounding_level": latent,
        "structural_class": structural,
        "finite_sample_limited": finite_sample_limited,
        "measurement_limited": damaged,
        "observable_diagnostics": {
            "treatment_prevalence": prevalence,
            "central_fraction_010_090": observed_central,
            "normalized_overlap_mass": normalized_overlap,
            "treated_ess": treated_ess,
            "control_ess": control_ess,
        },
        "evaluator_diagnostic_only": {
            "latent_confounding_present": latent > 0.0,
            "oracle_recoverability": structural != "STRUCTURALLY_UNSUPPORTED" and latent == 0.0,
        },
    }


def run_calibration() -> list[dict[str, Any]]:
    return [
        _record(level, n, measurement, latent, seed)
        for level in SUPPORT_LEVELS
        for n in SAMPLE_SIZES
        for measurement in MEASUREMENT_CONDITIONS
        for latent in LATENT_CONFOUNDING_LEVELS
        for seed in SEEDS
    ]

from __future__ import annotations

from dataclasses import dataclass

from attribution_lab.runner import corruption_for_quality
from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.config import WorldConfig
from attribution_lab.stress.corruption import CorruptionConfig

FOCAL_CHANNEL = Channel.META
SELECTION_STRENGTHS = (0.0, 1.25, 2.5)
FOCAL_PREVALENCE_ANCHORS = (0.15, 0.50, 0.85)
LATENT_INTENT_WEIGHTS = (0.0, 0.85, 1.70)
SAMPLE_SIZES = (80, 250, 800)
MEASUREMENT_QUALITIES = ("perfect", "missing_25", "fragmented_identity")
STUDY_SEEDS = (17, 41)
LARGE_REFERENCE_SIZE = 5000
LARGE_REFERENCE_SEED = 907


@dataclass(frozen=True, slots=True)
class StructuralCell:
    selection_strength: float
    focal_prevalence_anchor: float
    latent_intent_weight: float


@dataclass(frozen=True, slots=True)
class StudyCell:
    structural: StructuralCell
    sample_size: int
    measurement_quality: str
    seed: int


def structural_cells() -> tuple[StructuralCell, ...]:
    return tuple(
        StructuralCell(selection, prevalence, latent)
        for selection in SELECTION_STRENGTHS
        for prevalence in FOCAL_PREVALENCE_ANCHORS
        for latent in LATENT_INTENT_WEIGHTS
    )


def study_cells() -> tuple[StudyCell, ...]:
    return tuple(
        StudyCell(structural, sample_size, quality, seed)
        for structural in structural_cells()
        for sample_size in SAMPLE_SIZES
        for quality in MEASUREMENT_QUALITIES
        for seed in STUDY_SEEDS
    )


def world_config(structural: StructuralCell, *, sample_size: int, seed: int) -> WorldConfig:
    exposure = {
        Channel.META: structural.focal_prevalence_anchor,
        Channel.GOOGLE_BRAND: 0.30,
        Channel.GOOGLE_NON_BRAND: 0.30,
        Channel.PINTEREST: 0.25,
        Channel.EMAIL: 0.28,
        Channel.ORGANIC: 0.34,
        Channel.DIRECT: 0.34,
        Channel.REFERRAL: 0.18,
    }
    effects = {
        Channel.META: 0.45,
        Channel.GOOGLE_BRAND: 0.10,
        Channel.GOOGLE_NON_BRAND: 0.22,
        Channel.PINTEREST: 0.12,
        Channel.EMAIL: 0.20,
        Channel.ORGANIC: 0.06,
        Channel.DIRECT: 0.0,
        Channel.REFERRAL: 0.08,
    }
    proxy_strength = structural.selection_strength * 0.55
    selection = {
        Channel.META: structural.selection_strength,
        Channel.GOOGLE_BRAND: proxy_strength,
        Channel.GOOGLE_NON_BRAND: proxy_strength,
        Channel.ORGANIC: proxy_strength * 0.75,
    }
    return WorldConfig(
        scenario_name=(
            "identification-overlap"
            f"-s{structural.selection_strength:g}"
            f"-p{structural.focal_prevalence_anchor:g}"
            f"-l{structural.latent_intent_weight:g}"
        ),
        n_subjects=sample_size,
        seed=seed,
        baseline_conversion_probability=0.05,
        channel_exposure_probability=exposure,
        channel_log_odds_effect=effects,
        selection_strength=selection,
        latent_intent_weight=structural.latent_intent_weight,
        max_touchpoints=8,
        consent_granted_probability=1.0,
    )


def measurement_corruption(quality: str) -> CorruptionConfig:
    if quality == "perfect":
        return CorruptionConfig()
    return corruption_for_quality(quality)


def large_reference_config(structural: StructuralCell) -> WorldConfig:
    return world_config(
        structural,
        sample_size=LARGE_REFERENCE_SIZE,
        seed=LARGE_REFERENCE_SEED,
    )

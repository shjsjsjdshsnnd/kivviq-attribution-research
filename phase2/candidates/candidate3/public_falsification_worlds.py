from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from phase2_candidate3_contracts.contracts import TreatmentOpportunity
from phase2_candidate3_estimator.input import (
    Candidate3Case,
    Candidate3FeatureValue,
    Candidate3Unit,
)


@dataclass(frozen=True, slots=True)
class PublicFalsificationCase:
    case_id: str
    family: str
    case: Candidate3Case
    expected_decision: str
    ato_truth: float | None
    ate_truth: float | None
    effect_scored: bool
    ato_vs_ate_targeting_required: bool


def _sigmoid(value: float) -> float:
    if value >= 0:
        exp_value = math.exp(-value)
        return 1.0 / (1.0 + exp_value)
    exp_value = math.exp(value)
    return exp_value / (1.0 + exp_value)


def _generate(
    *,
    case_id: str,
    family: str,
    n: int,
    seed: int,
    treatment_intercept: float,
    selection_strength: float,
    treatment_effect: float,
    expected_decision: str,
    effect_scored: bool,
    ato_vs_ate_targeting_required: bool,
    effect_heterogeneity: float = 0.0,
    baseline_logit: float = -2.3,
    invalid_provenance: bool = False,
    latent_selection: float = 0.0,
    latent_outcome: float = 0.0,
) -> PublicFalsificationCase:
    rng = random.Random(seed)
    origin = datetime(2033, 1, 1, tzinfo=UTC)
    units: list[Candidate3Unit] = []
    true_effects: list[float] = []
    overlap_weights: list[float] = []

    for index in range(n):
        decision_time = origin + timedelta(hours=3 * index + 18)
        x1 = rng.gauss(0.0, 1.0)
        x2 = rng.gauss(0.0, 1.0)
        prior_search = float(rng.random() < _sigmoid(-0.25 + 0.45 * x1))
        prior_email = float(rng.random() < _sigmoid(-0.35 + 0.35 * x2))
        prior_touch_count = max(
            0,
            int(round(1.5 + 0.9 * abs(x1) + 0.6 * abs(x2) + rng.random() * 2)),
        )
        prior_sessions = max(0, min(prior_touch_count, 1 + int(rng.random() * 3)))
        recency_a = 1.0 + 30.0 * rng.random()
        recency_b = 3.0 + 42.0 * rng.random()
        latent = rng.gauss(0.0, 1.0)

        treatment_linear = (
            treatment_intercept
            + selection_strength * (0.70 * x1 - 0.50 * x2 + 0.40 * prior_search)
            + latent_selection * latent
        )
        propensity = _sigmoid(treatment_linear)
        treated = rng.random() < propensity

        tau = treatment_effect + effect_heterogeneity * x1
        baseline = (
            baseline_logit
            + 0.42 * x1
            - 0.28 * x2
            + 0.18 * prior_email
            + latent_outcome * latent
        )
        p0 = _sigmoid(baseline)
        p1 = _sigmoid(baseline + tau)
        outcome = int(rng.random() < (p1 if treated else p0))
        true_effects.append(p1 - p0)
        overlap_weights.append(propensity * (1.0 - propensity))

        pre_times = tuple(
            decision_time - timedelta(hours=4 + j)
            for j in range(max(prior_touch_count, 1))
        )
        source_times = (
            (decision_time + timedelta(minutes=2),)
            if invalid_provenance and index == 0
            else pre_times[:prior_touch_count]
        )
        features = (
            Candidate3FeatureValue(
                "prior_non_focal_channel_exposure_indicators",
                (prior_search, prior_email),
                source_times[: max(1, min(len(source_times), 2))],
            ),
            Candidate3FeatureValue(
                "prior_touch_count",
                (prior_touch_count / 8.0,),
                source_times,
            ),
            Candidate3FeatureValue(
                "prior_completed_session_count",
                (prior_sessions / 4.0,),
                pre_times[:prior_sessions],
            ),
            Candidate3FeatureValue(
                "prior_channel_recency_hours",
                (recency_a / 48.0, recency_b / 48.0),
                (
                    decision_time - timedelta(hours=recency_a),
                    decision_time - timedelta(hours=recency_b),
                ),
            ),
            Candidate3FeatureValue(
                "elapsed_observation_hours",
                (18.0 / 504.0,),
                (),
                True,
            ),
            Candidate3FeatureValue(
                "declared_baseline_covariates",
                (x1, x2),
                (),
                True,
            ),
        )
        units.append(
            Candidate3Unit(
                opportunity=TreatmentOpportunity(
                    subject_id=f"{case_id}-u-{index:04d}",
                    focal_channel="meta",
                    decision_time=decision_time,
                    treated=treated,
                    opportunity_source="declared_treatment_decision_opportunity",
                ),
                outcome=outcome,
                features=features,
            )
        )

    total_overlap = sum(overlap_weights)
    ato = (
        sum(
            weight * effect
            for weight, effect in zip(overlap_weights, true_effects, strict=True)
        )
        / total_overlap
    )
    ate = sum(true_effects) / len(true_effects)
    return PublicFalsificationCase(
        case_id=case_id,
        family=family,
        case=Candidate3Case(case_id=case_id, units=tuple(units)),
        expected_decision=expected_decision,
        ato_truth=ato,
        ate_truth=ate,
        effect_scored=effect_scored,
        ato_vs_ate_targeting_required=ato_vs_ate_targeting_required,
    )


def public_falsification_cases() -> tuple[PublicFalsificationCase, ...]:
    cases: list[PublicFalsificationCase] = []
    for suffix, seed in (("a", 4401), ("b", 4402)):
        cases.append(
            _generate(
                case_id=f"c3-pf-adequate-{suffix}",
                family="adequate_overlap_estimate",
                n=1250,
                seed=seed,
                treatment_intercept=0.10 if suffix == "a" else -0.15,
                selection_strength=0.70,
                treatment_effect=0.55 if suffix == "a" else -0.45,
                expected_decision="ESTIMATE_ATO",
                effect_scored=True,
                ato_vs_ate_targeting_required=False,
                baseline_logit=-2.15,
            )
        )
    for suffix, seed, intercept in (("a", 4411, -1.55), ("b", 4412, 1.55)):
        cases.append(
            _generate(
                case_id=f"c3-pf-weak-full-{suffix}",
                family="weak_full_support_ato",
                n=1600,
                seed=seed,
                treatment_intercept=intercept,
                selection_strength=1.75,
                treatment_effect=0.40,
                effect_heterogeneity=0.75 if suffix == "a" else -0.75,
                expected_decision="ESTIMATE_ATO",
                effect_scored=True,
                ato_vs_ate_targeting_required=True,
                baseline_logit=-2.15,
            )
        )
    for suffix, seed in (("a", 4421), ("b", 4422)):
        cases.append(
            _generate(
                case_id=f"c3-pf-heterogeneous-{suffix}",
                family="heterogeneous_signed_ato",
                n=1400,
                seed=seed,
                treatment_intercept=0.20,
                selection_strength=0.95,
                treatment_effect=-0.40,
                effect_heterogeneity=0.70,
                expected_decision="ESTIMATE_ATO",
                effect_scored=True,
                ato_vs_ate_targeting_required=True,
                baseline_logit=-2.10,
            )
        )
    for suffix, seed, intercept in (("a", 4431, -5.4), ("b", 4432, 5.4)):
        cases.append(
            _generate(
                case_id=f"c3-pf-support-abstain-{suffix}",
                family="inadequate_support_abstention",
                n=950,
                seed=seed,
                treatment_intercept=intercept,
                selection_strength=5.8,
                treatment_effect=0.45,
                expected_decision="ABSTAIN_INADEQUATE_SUPPORT",
                effect_scored=False,
                ato_vs_ate_targeting_required=False,
            )
        )
    for suffix, seed in (("a", 4441), ("b", 4442)):
        cases.append(
            _generate(
                case_id=f"c3-pf-finite-abstain-{suffix}",
                family="finite_sample_abstention",
                n=70,
                seed=seed,
                treatment_intercept=0.0,
                selection_strength=0.35,
                treatment_effect=0.50,
                expected_decision="ABSTAIN_INADEQUATE_FINITE_SAMPLE",
                effect_scored=False,
                ato_vs_ate_targeting_required=False,
                baseline_logit=-3.7,
            )
        )
    for suffix, seed in (("a", 4451), ("b", 4452)):
        cases.append(
            _generate(
                case_id=f"c3-pf-provenance-abstain-{suffix}",
                family="invalid_provenance_abstention",
                n=420,
                seed=seed,
                treatment_intercept=0.0,
                selection_strength=0.55,
                treatment_effect=0.45,
                expected_decision="ABSTAIN_PRETREATMENT_INVALID",
                effect_scored=False,
                ato_vs_ate_targeting_required=False,
                invalid_provenance=True,
            )
        )
    for suffix, seed in (("a", 4461), ("b", 4462)):
        cases.append(
            _generate(
                case_id=f"c3-pf-latent-nongoal-{suffix}",
                family="latent_confounding_nongoal",
                n=1250,
                seed=seed,
                treatment_intercept=0.0,
                selection_strength=0.35,
                treatment_effect=0.45,
                expected_decision="ESTIMATE_ATO",
                effect_scored=False,
                ato_vs_ate_targeting_required=False,
                latent_selection=1.35,
                latent_outcome=1.35,
            )
        )
    return tuple(cases)

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
class DevelopmentWorld:
    world_id: str
    case: Candidate3Case
    expected_decision: str
    ato_truth: float | None
    ate_truth: float | None
    scored_for_hyperparameter_selection: bool
    requires_ato_not_ate: bool = False


def _sigmoid(value: float) -> float:
    if value >= 0:
        exp_value = math.exp(-value)
        return 1.0 / (1.0 + exp_value)
    exp_value = math.exp(value)
    return exp_value / (1.0 + exp_value)


def _generate(
    *,
    world_id: str,
    n: int,
    seed: int,
    treatment_intercept: float,
    selection_strength: float,
    treatment_effect: float,
    effect_heterogeneity: float = 0.0,
    baseline_logit: float = -2.8,
    invalid_provenance: bool = False,
    latent_selection: float = 0.0,
    latent_outcome: float = 0.0,
) -> tuple[Candidate3Case, float, float]:
    rng = random.Random(seed)
    origin = datetime(2032, 1, 1, tzinfo=UTC)
    units: list[Candidate3Unit] = []
    true_effects: list[float] = []
    overlap_weights: list[float] = []

    for index in range(n):
        decision_time = origin + timedelta(hours=index * 2 + 24)
        x1 = rng.gauss(0.0, 1.0)
        x2 = rng.gauss(0.0, 1.0)
        prior_meta = 1.0 if rng.random() < _sigmoid(-0.2 + 0.5 * x1) else 0.0
        prior_email = 1.0 if rng.random() < _sigmoid(-0.4 + 0.4 * x2) else 0.0
        prior_touch_count = max(0, int(round(2.0 + 1.1 * abs(x1) + rng.random() * 2)))
        prior_sessions = max(0, min(prior_touch_count, 1 + int(rng.random() * 3)))
        recency_a = 2.0 + 24.0 * rng.random()
        recency_b = 4.0 + 36.0 * rng.random()
        latent = rng.gauss(0.0, 1.0)

        linear_treatment = (
            treatment_intercept
            + selection_strength * (0.75 * x1 - 0.55 * x2 + 0.35 * prior_meta)
            + latent_selection * latent
        )
        propensity = _sigmoid(linear_treatment)
        treated = rng.random() < propensity

        tau = treatment_effect + effect_heterogeneity * x1
        baseline = (
            baseline_logit
            + 0.45 * x1
            - 0.30 * x2
            + 0.15 * prior_email
            + latent_outcome * latent
        )
        p0 = _sigmoid(baseline)
        p1 = _sigmoid(baseline + tau)
        outcome = int(rng.random() < (p1 if treated else p0))

        true_effects.append(p1 - p0)
        overlap_weights.append(propensity * (1.0 - propensity))

        pre_times = tuple(
            decision_time - timedelta(hours=6 + j)
            for j in range(max(prior_touch_count, 1))
        )
        future_time = decision_time + timedelta(minutes=5)
        touch_times = (
            (future_time,)
            if invalid_provenance and index == 0
            else pre_times[:prior_touch_count]
        )
        features = (
            Candidate3FeatureValue(
                feature_name="prior_non_focal_channel_exposure_indicators",
                values=(prior_meta, prior_email),
                source_event_times=touch_times[: max(1, min(len(touch_times), 2))],
            ),
            Candidate3FeatureValue(
                feature_name="prior_touch_count",
                values=(prior_touch_count / 8.0,),
                source_event_times=touch_times,
            ),
            Candidate3FeatureValue(
                feature_name="prior_completed_session_count",
                values=(prior_sessions / 4.0,),
                source_event_times=pre_times[:prior_sessions],
            ),
            Candidate3FeatureValue(
                feature_name="prior_channel_recency_hours",
                values=(recency_a / 48.0, recency_b / 48.0),
                source_event_times=(
                    decision_time - timedelta(hours=recency_a),
                    decision_time - timedelta(hours=recency_b),
                ),
            ),
            Candidate3FeatureValue(
                feature_name="elapsed_observation_hours",
                values=(24.0 / 504.0,),
                source_event_times=(),
                baseline_available_before_decision=True,
            ),
            Candidate3FeatureValue(
                feature_name="declared_baseline_covariates",
                values=(x1, x2),
                source_event_times=(),
                baseline_available_before_decision=True,
            ),
        )
        units.append(
            Candidate3Unit(
                opportunity=TreatmentOpportunity(
                    subject_id=f"{world_id}-u-{index:04d}",
                    focal_channel="meta",
                    decision_time=decision_time,
                    treated=treated,
                    opportunity_source="declared_treatment_decision_opportunity",
                ),
                outcome=outcome,
                features=features,
            )
        )

    denominator = sum(overlap_weights)
    ato = sum(
        weight * effect
        for weight, effect in zip(overlap_weights, true_effects, strict=True)
    ) / denominator
    ate = sum(true_effects) / len(true_effects)
    return Candidate3Case(case_id=world_id, units=tuple(units)), ato, ate


def development_worlds() -> tuple[DevelopmentWorld, ...]:
    worlds: list[DevelopmentWorld] = []

    case, ato, ate = _generate(
        world_id="c3-dev-adequate-overlap",
        n=1500,
        seed=3301,
        treatment_intercept=0.0,
        selection_strength=0.55,
        treatment_effect=0.60,
        baseline_logit=-2.15,
    )
    worlds.append(
        DevelopmentWorld(
            "c3-dev-adequate-overlap",
            case,
            "ESTIMATE_ATO",
            ato,
            ate,
            True,
            False,
        )
    )

    case, ato, ate = _generate(
        world_id="c3-dev-weak-full-support",
        n=1500,
        seed=3302,
        treatment_intercept=-1.35,
        selection_strength=1.65,
        treatment_effect=0.45,
        effect_heterogeneity=0.70,
        baseline_logit=-2.15,
    )
    worlds.append(
        DevelopmentWorld(
            "c3-dev-weak-full-support",
            case,
            "ESTIMATE_ATO",
            ato,
            ate,
            True,
            True,
        )
    )

    case, ato, ate = _generate(
        world_id="c3-dev-inadequate-support",
        n=900,
        seed=3303,
        treatment_intercept=-5.2,
        selection_strength=5.5,
        treatment_effect=0.40,
    )
    worlds.append(
        DevelopmentWorld(
            "c3-dev-inadequate-support",
            case,
            "ABSTAIN_INADEQUATE_SUPPORT",
            ato,
            ate,
            True,
            False,
        )
    )

    case, ato, ate = _generate(
        world_id="c3-dev-finite-sample",
        n=65,
        seed=3304,
        treatment_intercept=0.0,
        selection_strength=0.35,
        treatment_effect=0.50,
        baseline_logit=-3.6,
    )
    worlds.append(
        DevelopmentWorld(
            "c3-dev-finite-sample",
            case,
            "ABSTAIN_INADEQUATE_FINITE_SAMPLE",
            ato,
            ate,
            True,
            False,
        )
    )

    case, ato, ate = _generate(
        world_id="c3-dev-invalid-provenance",
        n=360,
        seed=3305,
        treatment_intercept=0.0,
        selection_strength=0.45,
        treatment_effect=0.45,
        invalid_provenance=True,
    )
    worlds.append(
        DevelopmentWorld(
            "c3-dev-invalid-provenance",
            case,
            "ABSTAIN_PRETREATMENT_INVALID",
            ato,
            ate,
            True,
            False,
        )
    )

    case, ato, ate = _generate(
        world_id="c3-dev-heterogeneous-overlap",
        n=1300,
        seed=3306,
        treatment_intercept=0.25,
        selection_strength=0.85,
        treatment_effect=0.35,
        effect_heterogeneity=0.80,
        baseline_logit=-2.20,
    )
    worlds.append(
        DevelopmentWorld(
            "c3-dev-heterogeneous-overlap",
            case,
            "ESTIMATE_ATO",
            ato,
            ate,
            True,
            True,
        )
    )

    case, ato, ate = _generate(
        world_id="c3-dev-latent-confounding-nongoal",
        n=1200,
        seed=3307,
        treatment_intercept=0.0,
        selection_strength=0.35,
        treatment_effect=0.40,
        latent_selection=1.25,
        latent_outcome=1.25,
    )
    worlds.append(
        DevelopmentWorld(
            "c3-dev-latent-confounding-nongoal",
            case,
            "ESTIMATE_ATO",
            ato,
            ate,
            False,
            False,
        )
    )
    return tuple(worlds)

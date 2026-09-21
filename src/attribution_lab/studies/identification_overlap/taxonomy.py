from __future__ import annotations

from dataclasses import dataclass

EFFECT_GOOD = 0.03
EFFECT_POOR = 0.05
ADEQUATE_TRUE_EXTREME_FRACTION = 0.10
ADEQUATE_ESS_FRACTION = 0.10
MATERIAL_INFORMATION_LOGLOSS_GAP = 0.03
LOW_OBSERVABLE_PREDICTABILITY_GAIN = 0.01
ORACLE_PREDICTABILITY_GAIN = 0.03
MEASUREMENT_ERROR_INCREASE = 0.03


@dataclass(frozen=True, slots=True)
class TaxonomyResult:
    primary_limitation: str
    flags: tuple[str, ...]
    explanation: str


def classify(
    *,
    measurement_quality: str,
    sample_size: int,
    observable_error: float,
    oracle_error: float,
    perfect_same_sample_error: float,
    large_observable_error: float,
    large_oracle_error: float,
    oracle_extreme_fraction: float,
    oracle_min_ess_fraction: float,
    observable_predictability_gain: float,
    oracle_predictability_gain: float,
    information_logloss_gap: float,
    structural_unobserved_common_cause: bool,
) -> TaxonomyResult:
    flags: list[str] = []
    adequate_support = (
        oracle_extreme_fraction <= ADEQUATE_TRUE_EXTREME_FRACTION
        and oracle_min_ess_fraction >= ADEQUATE_ESS_FRACTION
    )
    if not adequate_support:
        flags.append("positivity_support")
    if structural_unobserved_common_cause:
        flags.append("unobserved_common_cause")
    if information_logloss_gap >= MATERIAL_INFORMATION_LOGLOSS_GAP:
        flags.append("observable_information_gap")

    if (
        measurement_quality != "perfect"
        and perfect_same_sample_error <= EFFECT_POOR
        and observable_error - perfect_same_sample_error >= MEASUREMENT_ERROR_INCREASE
    ):
        return TaxonomyResult(
            "measurement_limitation",
            tuple(flags),
            "Perfect measurement is recoverable at this sample size, but corruption materially increases error.",
        )

    if not adequate_support:
        return TaxonomyResult(
            "positivity_support_limitation",
            tuple(flags),
            "True treatment propensities place substantial population mass near deterministic treatment or yield weak effective support.",
        )

    if (
        measurement_quality == "perfect"
        and sample_size < 5000
        and large_observable_error <= EFFECT_GOOD
        and observable_error > EFFECT_POOR
    ):
        return TaxonomyResult(
            "finite_sample_limitation",
            tuple(flags),
            "The large-sample reference is recoverable but this finite sample is not.",
        )

    if (
        structural_unobserved_common_cause
        and large_oracle_error <= EFFECT_GOOD
        and large_observable_error > EFFECT_POOR
        and observable_predictability_gain <= LOW_OBSERVABLE_PREDICTABILITY_GAIN
        and oracle_predictability_gain >= ORACLE_PREDICTABILITY_GAIN
    ):
        return TaxonomyResult(
            "structurally_non_identifiable",
            tuple(flags),
            "A latent common cause drives treatment and outcome, oracle information restores recovery, and permitted observables contain little treatment-selection information.",
        )

    if (
        structural_unobserved_common_cause
        and large_oracle_error <= EFFECT_GOOD
        and large_observable_error > EFFECT_GOOD
        and information_logloss_gap >= MATERIAL_INFORMATION_LOGLOSS_GAP
    ):
        return TaxonomyResult(
            "observable_information_limitation",
            tuple(flags),
            "Oracle information materially improves selection prediction and causal recovery, while candidate-visible observables remain insufficient.",
        )

    if (
        adequate_support
        and large_observable_error > EFFECT_POOR
        and large_oracle_error > EFFECT_POOR
    ):
        return TaxonomyResult(
            "estimator_specification_limitation",
            tuple(flags),
            "Support is adequate and oracle information does not rescue the fixed diagnostic estimator at large sample.",
        )

    return TaxonomyResult(
        "no_dominant_limitation",
        tuple(flags),
        "No preregistered diagnostic rule assigns a dominant failure mechanism for this cell.",
    )

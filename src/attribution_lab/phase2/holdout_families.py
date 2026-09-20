from __future__ import annotations

from enum import StrEnum


class HoldoutFamily(StrEnum):
    SELECTION_SHIFT = "selection_shift"
    LATENT_INTENT_SHIFT = "latent_intent_shift"
    PREVALENCE_ORDERING_SHIFT = "prevalence_ordering_shift"
    TIME_VARYING_DELAYED = "time_varying_delayed"
    UNSEEN_INTERACTION = "unseen_interaction"
    NEGATIVE_HETEROGENEOUS = "negative_heterogeneous"
    SPARSE_IDENTITY_LOSS = "sparse_identity_loss"
    COMPOUNDED_MEASUREMENT = "compounded_measurement"


_DESCRIPTIONS = {
    HoldoutFamily.SELECTION_SHIFT: (
        "Unseen selection mechanisms with independently varied treatment effects."
    ),
    HoldoutFamily.LATENT_INTENT_SHIFT: (
        "Altered latent-intent strength and exposure coupling."
    ),
    HoldoutFamily.PREVALENCE_ORDERING_SHIFT: (
        "Changed channel/treatment prevalence and journey ordering structure."
    ),
    HoldoutFamily.TIME_VARYING_DELAYED: (
        "Treatment effects with hidden temporal change points and delayed components."
    ),
    HoldoutFamily.UNSEEN_INTERACTION: (
        "Interaction structures not directly represented by frozen Phase 1 worlds."
    ),
    HoldoutFamily.NEGATIVE_HETEROGENEOUS: (
        "Negative and heterogeneous treatment effects."
    ),
    HoldoutFamily.SPARSE_IDENTITY_LOSS: (
        "Sparse paths combined with identity fragmentation."
    ),
    HoldoutFamily.COMPOUNDED_MEASUREMENT: (
        "Multiple simultaneous measurement failures including channel-dependent missingness."
    ),
}


def public_holdout_family_manifest() -> tuple[tuple[str, str], ...]:
    """Expose family capabilities without instantiated hidden parameters."""
    return tuple((family.value, _DESCRIPTIONS[family]) for family in HoldoutFamily)

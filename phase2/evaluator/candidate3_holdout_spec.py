from __future__ import annotations

import hashlib
import json
import math
import random
import secrets
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

HOLDOUT_VERSION = "candidate3-holdout-v2"

PUBLIC_FAMILIES = (
    (
        "adequate_overlap_recovery",
        "Adequate overlap and finite-sample information; Candidate 3 should estimate the overlap-population effect.",
    ),
    (
        "weak_full_support_overlap_recovery",
        "Full-population support is weak but an overlap/equipoise population remains measurable; Candidate 3 should estimate ATO without making an ATE claim.",
    ),
    (
        "inadequate_overlap_abstention",
        "Treatment assignment is sufficiently deterministic that Candidate 3 should abstain for inadequate overlap/support.",
    ),
    (
        "finite_sample_abstention",
        "Structural overlap is adequate but realized effective information is intentionally small; Candidate 3 should abstain for finite-sample information.",
    ),
    (
        "measurement_provenance_abstention",
        "Required treatment-time provenance is incomplete or contaminated by post-treatment information; Candidate 3 should abstain rather than use future information.",
    ),
    (
        "latent_confounding_non_goal",
        "Overlap can be adequate while a hidden common cause remains; effect recovery is diagnostic only and Candidate 3 must not claim latent-confounding resolution.",
    ),
    (
        "overlap_boundary",
        "Worlds near preregistered support thresholds test deterministic abstention/estimate boundary behavior.",
    ),
    (
        "heterogeneous_overlap_effect",
        "Treatment effects vary across the observable support region; the target remains the explicitly overlap-weighted population effect.",
    ),
)


@dataclass(frozen=True, slots=True)
class HiddenInstance:
    family: str
    n_units: int
    seed: int
    treatment_intercept: float
    observed_selection_strength: float
    latent_selection_strength: float
    latent_outcome_strength: float
    baseline_outcome_logit: float
    treatment_effect_log_odds: float
    effect_heterogeneity: float
    decision_time_missing_fraction: float
    post_treatment_contamination_fraction: float
    outcome_rate_shift: float


def _fingerprint(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _logit(p: float) -> float:
    return math.log(p / (1.0 - p))


def _instance_for_family(rng: random.Random, family: str) -> HiddenInstance:
    seed = rng.randrange(1, 2**31 - 1)
    common = dict(
        family=family,
        seed=seed,
        decision_time_missing_fraction=0.0,
        post_treatment_contamination_fraction=0.0,
        effect_heterogeneity=0.0,
        latent_selection_strength=0.0,
        latent_outcome_strength=0.0,
        outcome_rate_shift=0.0,
    )

    if family == "adequate_overlap_recovery":
        return HiddenInstance(
            **common,
            n_units=rng.randint(500, 900),
            treatment_intercept=_logit(rng.uniform(0.40, 0.60)),
            observed_selection_strength=rng.uniform(0.35, 0.80),
            baseline_outcome_logit=_logit(rng.uniform(0.05, 0.10)),
            treatment_effect_log_odds=rng.uniform(-0.45, 0.65),
        )
    if family == "weak_full_support_overlap_recovery":
        return HiddenInstance(
            **common,
            n_units=rng.randint(650, 1000),
            treatment_intercept=_logit(rng.choice([rng.uniform(0.08, 0.18), rng.uniform(0.82, 0.92)])),
            observed_selection_strength=rng.uniform(1.25, 2.10),
            baseline_outcome_logit=_logit(rng.uniform(0.05, 0.10)),
            treatment_effect_log_odds=rng.uniform(-0.50, 0.70),
        )
    if family == "inadequate_overlap_abstention":
        return HiddenInstance(
            **common,
            n_units=rng.randint(700, 1100),
            treatment_intercept=_logit(rng.choice([rng.uniform(0.002, 0.012), rng.uniform(0.988, 0.998)])),
            observed_selection_strength=rng.uniform(5.0, 7.0),
            baseline_outcome_logit=_logit(rng.uniform(0.04, 0.09)),
            treatment_effect_log_odds=rng.uniform(-0.40, 0.60),
        )
    if family == "finite_sample_abstention":
        return HiddenInstance(
            **common,
            n_units=rng.randint(55, 95),
            treatment_intercept=_logit(rng.uniform(0.40, 0.60)),
            observed_selection_strength=rng.uniform(0.20, 0.70),
            baseline_outcome_logit=_logit(rng.uniform(0.025, 0.055)),
            treatment_effect_log_odds=rng.uniform(-0.50, 0.70),
        )
    if family == "measurement_provenance_abstention":
        return HiddenInstance(
            **{**common,
               "decision_time_missing_fraction": rng.uniform(0.12, 0.28),
               "post_treatment_contamination_fraction": rng.uniform(0.10, 0.25)},
            n_units=rng.randint(350, 700),
            treatment_intercept=_logit(rng.uniform(0.35, 0.65)),
            observed_selection_strength=rng.uniform(0.35, 0.90),
            baseline_outcome_logit=_logit(rng.uniform(0.05, 0.10)),
            treatment_effect_log_odds=rng.uniform(-0.45, 0.65),
        )
    if family == "latent_confounding_non_goal":
        return HiddenInstance(
            **{**common,
               "latent_selection_strength": rng.uniform(1.0, 1.8),
               "latent_outcome_strength": rng.uniform(1.0, 1.8)},
            n_units=rng.randint(700, 1100),
            treatment_intercept=_logit(rng.uniform(0.35, 0.65)),
            observed_selection_strength=rng.uniform(0.20, 0.60),
            baseline_outcome_logit=_logit(rng.uniform(0.05, 0.10)),
            treatment_effect_log_odds=rng.uniform(-0.45, 0.65),
        )
    if family == "overlap_boundary":
        return HiddenInstance(
            **common,
            n_units=rng.randint(220, 450),
            treatment_intercept=_logit(rng.choice([rng.uniform(0.15, 0.25), rng.uniform(0.75, 0.85)])),
            observed_selection_strength=rng.uniform(1.6, 2.7),
            baseline_outcome_logit=_logit(rng.uniform(0.04, 0.08)),
            treatment_effect_log_odds=rng.uniform(-0.45, 0.65),
        )
    if family == "heterogeneous_overlap_effect":
        return HiddenInstance(
            **{**common, "effect_heterogeneity": rng.uniform(0.35, 0.75)},
            n_units=rng.randint(650, 1000),
            treatment_intercept=_logit(rng.uniform(0.35, 0.65)),
            observed_selection_strength=rng.uniform(0.35, 0.90),
            baseline_outcome_logit=_logit(rng.uniform(0.05, 0.10)),
            treatment_effect_log_odds=rng.uniform(-0.35, 0.55),
        )
    raise ValueError(f"unknown family: {family}")


def create_private_seal(
    destination: Path,
    *,
    frozen_contracts: dict[str, Any],
) -> dict[str, Any]:
    if frozen_contracts["status"] != "CONTRACTS_FROZEN_BEFORE_HOLDOUT_SEAL":
        raise RuntimeError("Candidate 3 contracts are not frozen")
    if frozen_contracts["estimator_implemented"]:
        raise RuntimeError("Candidate 3 estimator existed before holdout sealing")
    if frozen_contracts["holdout_instantiated"]:
        raise RuntimeError("frozen contract manifest already claims a holdout")

    private_seed = secrets.randbits(63)
    rng = random.Random(private_seed)
    instances = [
        _instance_for_family(rng, family)
        for family, _description in PUBLIC_FAMILIES
    ]
    configuration_fingerprint = _fingerprint([asdict(instance) for instance in instances])
    generator_fingerprint = _fingerprint(
        {
            "version": HOLDOUT_VERSION,
            "source": Path(__file__).read_text(encoding="utf-8"),
            "contract_fingerprints": frozen_contracts["contract_fingerprints"],
        }
    )
    payload = {
        "version": HOLDOUT_VERSION,
        "private_seed": private_seed,
        "instances": [asdict(instance) for instance in instances],
        "configuration_fingerprint": configuration_fingerprint,
        "generator_fingerprint": generator_fingerprint,
        "contract_fingerprints": frozen_contracts["contract_fingerprints"],
        "contract_source_sha256": frozen_contracts["contract_source_sha256"],
        "contract_document_sha256": frozen_contracts["contract_document_sha256"],
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {
        "version": HOLDOUT_VERSION,
        "generator_fingerprint": generator_fingerprint,
        "configuration_fingerprint": configuration_fingerprint,
        "contract_fingerprints": frozen_contracts["contract_fingerprints"],
        "contract_source_sha256": frozen_contracts["contract_source_sha256"],
        "contract_document_sha256": frozen_contracts["contract_document_sha256"],
        "public_family_manifest": list(PUBLIC_FAMILIES),
        "private_seed_exposed": False,
        "private_parameters_committed_to_git": False,
        "status": "SEALED_AFTER_CONTRACT_FREEZE_BEFORE_ESTIMATOR_IMPLEMENTATION",
    }

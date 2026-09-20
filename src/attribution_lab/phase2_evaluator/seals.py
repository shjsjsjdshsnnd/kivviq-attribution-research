from __future__ import annotations

import hashlib
import json
import random
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from attribution_lab.phase2.constants import (
    EVALUATION_PROTOCOL_VERSION,
    HOLDOUT_GENERATOR_VERSION,
)
from attribution_lab.phase2.holdout_families import (
    HoldoutFamily,
    public_holdout_family_manifest,
)


class HoldoutVersionConflict(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class HoldoutSealMetadata:
    version: str
    generator_fingerprint: str
    configuration_fingerprint: str
    creation_timestamp: str
    scenario_family_manifest: tuple[tuple[str, str], ...]
    evaluation_protocol_version: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "generator_fingerprint": self.generator_fingerprint,
            "configuration_fingerprint": self.configuration_fingerprint,
            "creation_timestamp": self.creation_timestamp,
            "scenario_family_manifest": list(self.scenario_family_manifest),
            "evaluation_protocol_version": self.evaluation_protocol_version,
        }


def _fingerprint(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _generator_source_fingerprint(selected: tuple[HoldoutFamily, ...]) -> str:
    evaluator_root = Path(__file__).resolve().parent
    return _fingerprint(
        {
            "generator_version": HOLDOUT_GENERATOR_VERSION,
            "families": [family.value for family in selected],
            "seals_source": Path(__file__).read_text(encoding="utf-8"),
            "holdout_dgp_source": (evaluator_root / "holdout_dgp.py").read_text(
                encoding="utf-8"
            ),
        }
    )


def _random_channel(rng: random.Random) -> str:
    return rng.choice(
        [
            "channel_a",
            "channel_b",
            "channel_c",
            "channel_d",
            "channel_e",
            "channel_f",
            "channel_g",
            "channel_h",
        ]
    )


def _base_instance(rng: random.Random, family: HoldoutFamily) -> dict[str, Any]:
    channels = [
        "channel_a",
        "channel_b",
        "channel_c",
        "channel_d",
        "channel_e",
        "channel_f",
        "channel_g",
        "channel_h",
    ]
    exposure = {channel: rng.uniform(0.08, 0.58) for channel in channels}
    effects = {channel: rng.uniform(-0.18, 0.52) for channel in channels}
    selection = {channel: rng.uniform(-0.15, 0.15) for channel in channels}
    ordering = {channel: rng.uniform(0.05, 0.95) for channel in channels}
    interaction_pair = tuple(rng.sample(channels, 2))
    return {
        "family": family.value,
        "n_subjects": rng.randint(120, 260),
        "baseline_conversion_probability": rng.uniform(0.025, 0.14),
        "latent_intent_weight": rng.uniform(0.45, 1.45),
        "exposure_probability": exposure,
        "treatment_effects": effects,
        "selection_strength": selection,
        "ordering_position": ordering,
        "interaction_pair": interaction_pair,
        "interaction_effect": rng.uniform(-0.45, 0.85),
        "heterogeneity_channel": _random_channel(rng),
        "heterogeneity_strength": rng.uniform(0.0, 0.65),
        "temporal_channel": _random_channel(rng),
        "temporal_change_point": rng.uniform(0.25, 0.75),
        "temporal_shift": rng.uniform(-0.55, 0.70),
        "delayed_channel": _random_channel(rng),
        "delayed_cutoff": rng.uniform(0.25, 0.65),
        "delayed_effect": rng.uniform(-0.30, 0.55),
        "max_touches": rng.randint(2, 7),
        "random_missing_probability": 0.0,
        "channel_missing_channel": _random_channel(rng),
        "channel_missing_probability": 0.0,
        "identity_fragmentation_probability": 0.0,
    }


def _instantiate_family(rng: random.Random, family: HoldoutFamily) -> dict[str, Any]:
    params = _base_instance(rng, family)
    if family == HoldoutFamily.SELECTION_SHIFT:
        channel = _random_channel(rng)
        params["selection_strength"][channel] = rng.uniform(1.4, 3.0)
        params["treatment_effects"][channel] = rng.uniform(-0.05, 0.08)
    elif family == HoldoutFamily.LATENT_INTENT_SHIFT:
        params["latent_intent_weight"] = rng.uniform(1.6, 2.5)
        for channel in rng.sample(list(params["selection_strength"]), 3):
            params["selection_strength"][channel] = rng.uniform(0.8, 2.2)
    elif family == HoldoutFamily.PREVALENCE_ORDERING_SHIFT:
        for channel in rng.sample(list(params["exposure_probability"]), 3):
            params["exposure_probability"][channel] = rng.uniform(0.65, 0.92)
        late = _random_channel(rng)
        params["ordering_position"][late] = rng.uniform(0.88, 0.99)
    elif family == HoldoutFamily.TIME_VARYING_DELAYED:
        params["temporal_shift"] = rng.choice([-1.0, 1.0]) * rng.uniform(0.55, 1.0)
        params["delayed_effect"] = rng.choice([-1.0, 1.0]) * rng.uniform(0.35, 0.8)
    elif family == HoldoutFamily.UNSEEN_INTERACTION:
        params["interaction_effect"] = rng.choice([-1.0, 1.0]) * rng.uniform(0.8, 1.5)
    elif family == HoldoutFamily.NEGATIVE_HETEROGENEOUS:
        channel = params["heterogeneity_channel"]
        params["treatment_effects"][channel] = -rng.uniform(0.55, 1.1)
        params["heterogeneity_strength"] = rng.uniform(0.55, 1.0)
    elif family == HoldoutFamily.SPARSE_IDENTITY_LOSS:
        params["max_touches"] = rng.randint(1, 3)
        for channel in params["exposure_probability"]:
            params["exposure_probability"][channel] *= rng.uniform(0.25, 0.55)
        params["identity_fragmentation_probability"] = rng.uniform(0.35, 0.65)
    elif family == HoldoutFamily.COMPOUNDED_MEASUREMENT:
        params["random_missing_probability"] = rng.uniform(0.20, 0.45)
        params["channel_missing_probability"] = rng.uniform(0.35, 0.70)
        params["identity_fragmentation_probability"] = rng.uniform(0.25, 0.55)
    return params


class HoldoutSealStore:
    """Evaluator-owned seal storage.

    Seal files contain synthetic hidden parameters and must live outside the
    repository. The public metadata intentionally exposes fingerprints and
    family names, not instantiated parameter values.
    """

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, version: str) -> Path:
        return self.root / f"{version}.seal.json"

    def create(
        self,
        version: str,
        *,
        seed: int | None = None,
        created_at: str | None = None,
        families: tuple[HoldoutFamily, ...] | None = None,
    ) -> HoldoutSealMetadata:
        path = self._path(version)
        if path.exists():
            raise HoldoutVersionConflict(
                f"{version} already exists; create a new holdout version"
            )
        private_seed = seed if seed is not None else secrets.randbits(63)
        rng = random.Random(private_seed)
        selected = families or tuple(HoldoutFamily)
        instances = [_instantiate_family(rng, family) for family in selected]
        configuration_fingerprint = _fingerprint(instances)
        generator_fingerprint = _generator_source_fingerprint(selected)
        timestamp = created_at or datetime.now(UTC).isoformat()
        payload = {
            "metadata": {
                "version": version,
                "generator_fingerprint": generator_fingerprint,
                "configuration_fingerprint": configuration_fingerprint,
                "creation_timestamp": timestamp,
                "scenario_family_manifest": [
                    (family.value, dict(public_holdout_family_manifest())[family.value])
                    for family in selected
                ],
                "evaluation_protocol_version": EVALUATION_PROTOCOL_VERSION,
            },
            "private_seed": private_seed,
            "instances": instances,
        }
        path.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return self.public_metadata(version)

    def public_metadata(self, version: str) -> HoldoutSealMetadata:
        payload = json.loads(self._path(version).read_text(encoding="utf-8"))
        metadata = payload["metadata"]
        return HoldoutSealMetadata(
            version=metadata["version"],
            generator_fingerprint=metadata["generator_fingerprint"],
            configuration_fingerprint=metadata["configuration_fingerprint"],
            creation_timestamp=metadata["creation_timestamp"],
            scenario_family_manifest=tuple(
                (str(name), str(description))
                for name, description in metadata["scenario_family_manifest"]
            ),
            evaluation_protocol_version=metadata["evaluation_protocol_version"],
        )

    def load_private_instances(self, version: str) -> tuple[dict[str, Any], ...]:
        payload = json.loads(self._path(version).read_text(encoding="utf-8"))
        return tuple(payload["instances"])

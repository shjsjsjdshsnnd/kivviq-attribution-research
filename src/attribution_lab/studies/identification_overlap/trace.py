from __future__ import annotations

# ruff: noqa: I001

import math
import random as stdlib_random
from dataclasses import dataclass
from types import SimpleNamespace

from attribution_lab.schemas.core import Channel
from attribution_lab.simulation.config import WorldConfig
from attribution_lab.simulation import generator as frozen_generator
from attribution_lab.simulation.generator import SyntheticWorld


@dataclass(frozen=True, slots=True)
class OracleSubject:
    subject_id: str
    latent_intent: float
    true_focal_propensity: float


@dataclass(frozen=True, slots=True)
class InstrumentedWorld:
    world: SyntheticWorld
    oracle_subjects: tuple[OracleSubject, ...]


class _TracingRandom(stdlib_random.Random):
    latent_intents: list[float]

    def __init__(self, seed: int | None = None) -> None:
        super().__init__(seed)
        self.latent_intents = []

    def gauss(self, mu: float = 0.0, sigma: float = 1.0) -> float:
        value = super().gauss(mu, sigma)
        if mu == 0.0 and sigma == 1.0:
            self.latent_intents.append(value)
        return value


def _sigmoid(value: float) -> float:
    if value >= 0:
        exponent = math.exp(-value)
        return 1.0 / (1.0 + exponent)
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


def _logit(probability: float) -> float:
    return math.log(probability / (1.0 - probability))


def generate_instrumented_world(
    config: WorldConfig,
    *,
    focal_channel: Channel,
) -> InstrumentedWorld:
    """Run the frozen generator while recording latent intent without altering RNG draws."""
    original_random = frozen_generator.random
    tracer: _TracingRandom | None = None

    class _Factory(_TracingRandom):
        def __init__(self, seed: int | None = None) -> None:
            nonlocal tracer
            super().__init__(seed)
            tracer = self

    frozen_generator.random = SimpleNamespace(Random=_Factory)  # type: ignore[assignment]
    try:
        world = frozen_generator.generate_world(config)
    finally:
        frozen_generator.random = original_random

    if tracer is None or len(tracer.latent_intents) != config.n_subjects:
        raise RuntimeError("failed to capture exactly one latent intent per synthetic subject")

    base = float(config.channel_exposure_probability.get(focal_channel, 0.0))
    strength = float(config.selection_strength.get(focal_channel, 0.0))
    oracle: list[OracleSubject] = []
    for index, latent in enumerate(tracer.latent_intents):
        if base <= 0.0:
            propensity = 0.0
        elif base >= 1.0:
            propensity = 1.0
        else:
            propensity = _sigmoid(_logit(base) + strength * latent)
        oracle.append(
            OracleSubject(
                subject_id=f"u-{index:06d}",
                latent_intent=latent,
                true_focal_propensity=propensity,
            )
        )
    return InstrumentedWorld(world=world, oracle_subjects=tuple(oracle))

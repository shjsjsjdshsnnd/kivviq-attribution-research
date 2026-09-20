from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class EvaluationStage(StrEnum):
    DEVELOPMENT = "DEVELOPMENT"
    FROZEN_PHASE1 = "FROZEN_PHASE1"
    SEALED_HOLDOUT = "SEALED_HOLDOUT"


class ScenarioStatus(StrEnum):
    EVALUATED = "evaluated"
    UNSUPPORTED = "unsupported"
    INVALID_OUTPUT = "invalid_output"
    ERROR = "error"


class GateOutcome(StrEnum):
    SURVIVE = "SURVIVE"
    REJECT = "REJECT"
    INCONCLUSIVE = "INCONCLUSIVE"


@dataclass(frozen=True, slots=True)
class ScenarioResult:
    stage: EvaluationStage
    family: str
    status: ScenarioStatus
    metrics: tuple[tuple[str, float], ...]
    uncertainty_present: bool
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class SeparatedEvaluationReport:
    development_results: tuple[ScenarioResult, ...]
    frozen_phase1_results: tuple[ScenarioResult, ...]
    sealed_holdout_results: tuple[ScenarioResult, ...]

    def __post_init__(self) -> None:
        if any(
            result.stage != EvaluationStage.DEVELOPMENT
            for result in self.development_results
        ):
            raise ValueError("development results must stay in DEVELOPMENT")
        if any(
            result.stage != EvaluationStage.FROZEN_PHASE1
            for result in self.frozen_phase1_results
        ):
            raise ValueError("Phase 1 results must stay in FROZEN_PHASE1")
        if any(
            result.stage != EvaluationStage.SEALED_HOLDOUT
            for result in self.sealed_holdout_results
        ):
            raise ValueError("holdout results must stay in SEALED_HOLDOUT")

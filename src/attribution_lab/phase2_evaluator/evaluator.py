from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass

from attribution_lab.phase2.constants import (
    EVALUATION_PROTOCOL_VERSION,
    FROZEN_PHASE1_COMMIT,
)
from attribution_lab.phase2.registration import CandidateRegistry
from attribution_lab.phase2_evaluator.exposure import (
    AuditReplayIntegrityError,
    AuditReplayReceipt,
    HoldoutExposureController,
)
from attribution_lab.phase2_evaluator.holdout_dgp import generate_holdout
from attribution_lab.phase2_evaluator.isolation import (
    CandidateExecutionError,
    CandidateRunner,
)
from attribution_lab.phase2_evaluator.ledger import ResearchLedger
from attribution_lab.phase2_evaluator.results import (
    REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    EvaluationStage,
    ScenarioResult,
    ScenarioStatus,
    SeparatedEvaluationReport,
)
from attribution_lab.phase2_evaluator.seals import HoldoutSealStore
from phase2_candidate_sdk import (
    CandidateDeclaration,
    DeclaredContext,
    CandidateResponse,
    ObservableDataset,
    fingerprint_payload,
)


def _instance_seed(version: str, family: str, index: int) -> int:
    digest = hashlib.sha256(
        f"{version}|{family}|{index}|{EVALUATION_PROTOCOL_VERSION}".encode()
    ).digest()
    return int.from_bytes(digest[:8], "big")


def _score(
    response: CandidateResponse,
    truth: dict[str, float],
) -> tuple[tuple[str, float], ...]:
    estimates = dict(response.estimates)
    common = sorted(set(estimates) & set(truth))
    if not common:
        return (("mean_absolute_error", float("inf")),)
    errors = [abs(estimates[key] - truth[key]) for key in common]
    metrics: list[tuple[str, float]] = [
        ("mean_absolute_error", sum(errors) / len(errors)),
        ("max_absolute_error", max(errors)),
        ("coverage_fraction", len(common) / len(truth)),
    ]
    if response.uncertainty is not None:
        lower = dict(response.uncertainty.lower)
        upper = dict(response.uncertainty.upper)
        covered = [
            lower[key] <= truth[key] <= upper[key]
            for key in common
        ]
        widths = [upper[key] - lower[key] for key in common]
        metrics.extend(
            [
                (
                    "interval_coverage_fraction",
                    sum(int(value) for value in covered) / len(covered),
                ),
                ("mean_interval_width", sum(widths) / len(widths)),
            ]
        )
    return tuple(metrics)


def _result_digest(results: tuple[ScenarioResult, ...]) -> str:
    return fingerprint_payload([asdict(result) for result in results])


@dataclass(frozen=True, slots=True)
class RobustnessPlan:
    repeated_seeds: tuple[int, ...]
    sample_sizes: tuple[int, ...]
    measurement_degradation_levels: tuple[float, ...]
    include_sparsity: bool
    include_identity_loss: bool
    include_temporal_shifts: bool
    include_selection_shifts: bool
    uncertainty_method: str


class HoldoutEvaluator:
    def __init__(
        self,
        seal_store: HoldoutSealStore,
        registry: CandidateRegistry,
        ledger: ResearchLedger | None = None,
        runner: CandidateRunner | None = None,
    ) -> None:
        self.seal_store = seal_store
        self.registry = registry
        self.ledger = ledger or ResearchLedger(registry.root / "research-ledger.jsonl")
        self.runner = runner or CandidateRunner()
        self.exposure = HoldoutExposureController(registry, self.ledger)

    def _run_holdout(
        self,
        declaration: CandidateDeclaration,
        source: str,
        *,
        holdout_version: str,
    ) -> tuple[ScenarioResult, ...]:
        metadata = self.seal_store.public_metadata(holdout_version)
        results: list[ScenarioResult] = []
        for index, params in enumerate(
            self.seal_store.load_private_instances(holdout_version)
        ):
            family = str(params["family"])
            generated = generate_holdout(
                params,
                seed=_instance_seed(holdout_version, family, index),
            )
            context = DeclaredContext(
                stage=EvaluationStage.SEALED_HOLDOUT.value,
                scenario_family=family,
                estimand_fingerprint=fingerprint_payload(asdict(declaration.estimand)),
                phase1_reference=FROZEN_PHASE1_COMMIT,
                holdout_version=metadata.version,
                protocol_version=metadata.evaluation_protocol_version,
            )
            try:
                response = self.runner.execute(
                    source,
                    generated.observable_dataset,
                    context,
                )
            except (CandidateExecutionError, ValueError):
                results.append(
                    ScenarioResult(
                        stage=EvaluationStage.SEALED_HOLDOUT,
                        family=family,
                        status=ScenarioStatus.INVALID_OUTPUT,
                        metrics=(),
                        uncertainty_present=False,
                        reason="candidate execution or output validation failed",
                    )
                )
                continue
            results.append(
                ScenarioResult(
                    stage=EvaluationStage.SEALED_HOLDOUT,
                    family=family,
                    status=ScenarioStatus.EVALUATED,
                    metrics=_score(
                        response,
                        dict(generated.oracle_truth.channel_effects),
                    ),
                    uncertainty_present=response.uncertainty is not None,
                )
            )
        return tuple(results)

    def evaluate(
        self,
        declaration: CandidateDeclaration,
        source: str,
        *,
        holdout_version: str,
    ) -> tuple[ScenarioResult, ...]:
        identity = self.exposure.consume_feedback(
            declaration,
            source,
            holdout_version,
        )
        results = self._run_holdout(
            declaration,
            source,
            holdout_version=holdout_version,
        )
        self.exposure.record_feedback_result(
            identity,
            holdout_version,
            _result_digest(results),
        )
        return results

    def audit_replay(
        self,
        declaration: CandidateDeclaration,
        source: str,
        *,
        holdout_version: str,
    ) -> AuditReplayReceipt:
        identity, expected_digest = self.exposure.expected_audit_digest(
            declaration,
            source,
            holdout_version,
        )
        results = self._run_holdout(
            declaration,
            source,
            holdout_version=holdout_version,
        )
        actual_digest = _result_digest(results)
        if actual_digest != expected_digest:
            raise AuditReplayIntegrityError("audit replay did not reproduce frozen results")
        self.exposure.record_audit_replay(
            identity,
            holdout_version,
            actual_digest,
        )
        return AuditReplayReceipt(
            label="AUDIT_REPLAY",
            holdout_version=holdout_version,
            evaluation_protocol_version=EVALUATION_PROTOCOL_VERSION,
            integrity_match=True,
        )


def empty_separated_report(
    holdout_results: tuple[ScenarioResult, ...],
) -> SeparatedEvaluationReport:
    return SeparatedEvaluationReport(
        development_results=(),
        frozen_phase1_results=(),
        sealed_holdout_results=holdout_results,
        holdout_limitation_disclosure=REQUIRED_HOLDOUT_LIMITATION_DISCLOSURE,
    )


def evaluate_known_case(
    declaration: CandidateDeclaration,
    source: str,
    *,
    dataset: ObservableDataset,
    synthetic_truth: tuple[tuple[str, float], ...],
    stage: EvaluationStage,
    family: str,
    phase1_reference: str | None = None,
    runner: CandidateRunner | None = None,
) -> ScenarioResult:
    """Run the same standardized candidate contract on DEVELOPMENT/FROZEN_PHASE1."""
    if stage == EvaluationStage.SEALED_HOLDOUT:
        raise ValueError("sealed holdouts must use HoldoutEvaluator")
    execution = runner or CandidateRunner()
    context = DeclaredContext(
        stage=stage.value,
        scenario_family=family,
        estimand_fingerprint=fingerprint_payload(asdict(declaration.estimand)),
        phase1_reference=phase1_reference,
        holdout_version=None,
        protocol_version=EVALUATION_PROTOCOL_VERSION,
    )
    try:
        response = execution.execute(source, dataset, context)
    except (CandidateExecutionError, ValueError):
        return ScenarioResult(
            stage=stage,
            family=family,
            status=ScenarioStatus.INVALID_OUTPUT,
            metrics=(),
            uncertainty_present=False,
            reason="candidate execution or output validation failed",
        )
    return ScenarioResult(
        stage=stage,
        family=family,
        status=ScenarioStatus.EVALUATED,
        metrics=_score(response, dict(synthetic_truth)),
        uncertainty_present=response.uncertainty is not None,
    )

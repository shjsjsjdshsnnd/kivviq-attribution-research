from __future__ import annotations

import hashlib
import math
from dataclasses import asdict, dataclass

import numpy as np

from phase2_candidate3_contracts.contracts import (
    Candidate3Decision,
    Candidate3OutputContract,
    FiniteSampleStatus,
    SupportDiagnostics,
    SupportStatus,
    build_ato_estimand_contract,
    build_pretreatment_x_contract,
    build_support_abstention_contract,
    build_uncertainty_contract,
    candidate3_decision,
    finite_sample_status,
    support_status,
)
from phase2_candidate3_estimator.input import Candidate3Case, PreparedCase, prepare_case

PROPENSITY_L2 = 0.1
MAX_ITERATIONS = 80
CONVERGENCE_TOLERANCE = 1e-8
BOOTSTRAP_REPLICATES = 400


@dataclass(frozen=True, slots=True)
class PointPipelineResult:
    estimate: float
    diagnostics: SupportDiagnostics
    propensities: tuple[float, ...]
    converged: bool


@dataclass(frozen=True, slots=True)
class Candidate3Result:
    output: Candidate3OutputContract
    diagnostics: SupportDiagnostics | None
    propensity_l2: float
    bootstrap_requested: int
    bootstrap_valid: int
    feature_columns: tuple[str, ...]
    provenance_valid: bool

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _sigmoid(values: np.ndarray) -> np.ndarray:
    result = 1.0 / (1.0 + np.exp(-np.clip(values, -35.0, 35.0)))
    return np.asarray(result, dtype=float)


def _fit_propensity(
    features: np.ndarray,
    treatment: np.ndarray,
    *,
    l2: float,
) -> tuple[np.ndarray, bool]:
    matrix = np.column_stack([np.ones(features.shape[0]), features])
    beta = np.zeros(matrix.shape[1], dtype=float)
    penalty = np.ones(matrix.shape[1], dtype=float)
    penalty[0] = 0.0
    converged = False

    for _ in range(MAX_ITERATIONS):
        probability = _sigmoid(matrix @ beta)
        variance = np.clip(probability * (1.0 - probability), 1e-6, None)
        gradient = matrix.T @ (treatment - probability) - l2 * penalty * beta
        information = matrix.T @ (variance[:, None] * matrix)
        information += np.diag(l2 * penalty + 1e-9)
        try:
            step = np.linalg.solve(information, gradient)
        except np.linalg.LinAlgError:
            step = np.linalg.lstsq(information, gradient, rcond=None)[0]
        largest = float(np.max(np.abs(step)))
        if largest > 2.0:
            step *= 2.0 / largest
        beta += step
        if float(np.max(np.abs(step))) < CONVERGENCE_TOLERANCE:
            converged = True
            break

    return _sigmoid(matrix @ beta), converged


def _ess(weights: np.ndarray) -> float:
    if weights.size == 0:
        return 0.0
    denominator = float(np.sum(weights * weights))
    if denominator <= 0.0:
        return 0.0
    total = float(np.sum(weights))
    return total * total / denominator


def _point_pipeline(
    prepared: PreparedCase,
    *,
    l2: float,
) -> PointPipelineResult:
    treatment = prepared.treatment
    outcome = prepared.outcome
    treated = treatment == 1.0
    control = treatment == 0.0
    treated_count = int(np.sum(treated))
    control_count = int(np.sum(control))
    if treated_count == 0 or control_count == 0:
        propensities = np.full(treatment.shape, float(np.mean(treatment)))
        converged = False
    else:
        propensities, converged = _fit_propensity(
            prepared.design_matrix,
            treatment,
            l2=l2,
        )

    overlap_weight = propensities * (1.0 - propensities)
    normalized_overlap_mass = float(4.0 * np.mean(overlap_weight))
    central_fraction = float(
        np.mean((propensities >= 0.10) & (propensities <= 0.90))
    )
    treated_weights = (1.0 - propensities)[treated]
    control_weights = propensities[control]

    treated_denom = float(np.sum(treated_weights))
    control_denom = float(np.sum(control_weights))
    if treated_denom <= 0.0 or control_denom <= 0.0:
        estimate = float("nan")
    else:
        estimate = float(
            np.sum(treated_weights * outcome[treated]) / treated_denom
            - np.sum(control_weights * outcome[control]) / control_denom
        )

    diagnostics = SupportDiagnostics(
        central_overlap_fraction=central_fraction,
        normalized_overlap_mass=normalized_overlap_mass,
        treated_count=treated_count,
        control_count=control_count,
        total_overlap_ess=_ess(
            np.where(treated, 1.0 - propensities, propensities)
        ),
        treated_overlap_ess=_ess(treated_weights),
        control_overlap_ess=_ess(control_weights),
        outcome_events=int(np.sum(outcome)),
    )
    return PointPipelineResult(
        estimate=estimate,
        diagnostics=diagnostics,
        propensities=tuple(float(value) for value in propensities),
        converged=converged and math.isfinite(estimate),
    )


def _bootstrap_seed(case_id: str, lineage_fingerprint: str) -> int:
    digest = hashlib.sha256(
        f"{case_id}|{lineage_fingerprint}|candidate3-ato-bootstrap-v1".encode()
    ).digest()
    return int.from_bytes(digest[:8], "big")


def _bootstrap(
    prepared: PreparedCase,
    *,
    l2: float,
    lineage_fingerprint: str,
    replicates: int,
) -> tuple[list[float], int]:
    rng = np.random.default_rng(
        _bootstrap_seed(prepared.case_id, lineage_fingerprint)
    )
    estimates: list[float] = []
    n = len(prepared.subject_ids)
    support_contract = build_support_abstention_contract()
    uncertainty_contract = build_uncertainty_contract()

    for _ in range(replicates):
        indices = rng.integers(0, n, size=n)
        sampled = PreparedCase(
            case_id=prepared.case_id,
            subject_ids=tuple(prepared.subject_ids[index] for index in indices),
            focal_channel=prepared.focal_channel,
            treatment=prepared.treatment[indices],
            outcome=prepared.outcome[indices],
            design_matrix=prepared.design_matrix[indices, :],
            feature_columns=prepared.feature_columns,
        )
        result = _point_pipeline(sampled, l2=l2)
        if not result.converged:
            continue
        if support_status(result.diagnostics, support_contract) != SupportStatus.ADEQUATE:
            continue
        if (
            finite_sample_status(
                result.diagnostics,
                support_contract,
                uncertainty_contract,
            )
            != FiniteSampleStatus.ADEQUATE
        ):
            continue
        if math.isfinite(result.estimate):
            estimates.append(result.estimate)
    return estimates, replicates


def _abstention_output(
    decision: Candidate3Decision,
    *,
    support: SupportStatus,
    finite: FiniteSampleStatus,
) -> Candidate3OutputContract:
    estimand = build_ato_estimand_contract()
    return Candidate3OutputContract(
        decision=decision,
        estimand="ATO / overlap-population incremental conversion effect",
        estimate=None,
        interval_lower=None,
        interval_upper=None,
        target_population=estimand.target_population,
        full_population_ate=None,
        support_status=support,
        finite_sample_status=finite,
        identification_statement=(
            "identified only conditional on declared pre-treatment observables and "
            "the frozen Candidate 3 causal assumptions"
        ),
        latent_confounding_statement=(
            "Candidate 3 does not solve latent confounding or unmeasured common causes"
        ),
    )


def estimate(
    case: Candidate3Case,
    *,
    lineage_fingerprint: str,
    bootstrap_replicates: int = BOOTSTRAP_REPLICATES,
    propensity_l2: float = PROPENSITY_L2,
) -> Candidate3Result:
    if bootstrap_replicates != BOOTSTRAP_REPLICATES:
        raise ValueError("full Candidate 3 estimation requires exactly 400 bootstrap refits")

    x_contract = build_pretreatment_x_contract()
    support_contract = build_support_abstention_contract()
    uncertainty_contract = build_uncertainty_contract()

    try:
        prepared = prepare_case(case, x_contract)
    except ValueError:
        return Candidate3Result(
            output=_abstention_output(
                Candidate3Decision.ABSTAIN_PRETREATMENT_INVALID,
                support=SupportStatus.INADEQUATE,
                finite=FiniteSampleStatus.INADEQUATE,
            ),
            diagnostics=None,
            propensity_l2=propensity_l2,
            bootstrap_requested=bootstrap_replicates,
            bootstrap_valid=0,
            feature_columns=(),
            provenance_valid=False,
        )

    point = _point_pipeline(prepared, l2=propensity_l2)
    if not point.converged:
        decision = Candidate3Decision.ABSTAIN_INADEQUATE_FINITE_SAMPLE
    else:
        decision = candidate3_decision(
            pretreatment_valid=True,
            diagnostics=point.diagnostics,
            support_contract=support_contract,
            uncertainty_contract=uncertainty_contract,
        )

    support = support_status(point.diagnostics, support_contract)
    finite = finite_sample_status(
        point.diagnostics,
        support_contract,
        uncertainty_contract,
    )
    if decision != Candidate3Decision.ESTIMATE_ATO:
        return Candidate3Result(
            output=_abstention_output(
                decision,
                support=support,
                finite=finite,
            ),
            diagnostics=point.diagnostics,
            propensity_l2=propensity_l2,
            bootstrap_requested=bootstrap_replicates,
            bootstrap_valid=0,
            feature_columns=prepared.feature_columns,
            provenance_valid=True,
        )

    bootstrap, requested = _bootstrap(
        prepared,
        l2=propensity_l2,
        lineage_fingerprint=lineage_fingerprint,
        replicates=bootstrap_replicates,
    )
    valid_fraction = len(bootstrap) / requested
    if bootstrap:
        lower = float(np.quantile(np.asarray(bootstrap), 0.05))
        upper = float(np.quantile(np.asarray(bootstrap), 0.95))
        interval_width = upper - lower
    else:
        lower = float("nan")
        upper = float("nan")
        interval_width = float("inf")

    diagnostics = SupportDiagnostics(
        central_overlap_fraction=point.diagnostics.central_overlap_fraction,
        normalized_overlap_mass=point.diagnostics.normalized_overlap_mass,
        treated_count=point.diagnostics.treated_count,
        control_count=point.diagnostics.control_count,
        total_overlap_ess=point.diagnostics.total_overlap_ess,
        treated_overlap_ess=point.diagnostics.treated_overlap_ess,
        control_overlap_ess=point.diagnostics.control_overlap_ess,
        outcome_events=point.diagnostics.outcome_events,
        valid_bootstrap_fraction=valid_fraction,
        interval_width=interval_width,
    )
    finite = finite_sample_status(
        diagnostics,
        support_contract,
        uncertainty_contract,
    )
    if finite == FiniteSampleStatus.INADEQUATE:
        return Candidate3Result(
            output=_abstention_output(
                Candidate3Decision.ABSTAIN_INADEQUATE_FINITE_SAMPLE,
                support=SupportStatus.ADEQUATE,
                finite=finite,
            ),
            diagnostics=diagnostics,
            propensity_l2=propensity_l2,
            bootstrap_requested=requested,
            bootstrap_valid=len(bootstrap),
            feature_columns=prepared.feature_columns,
            provenance_valid=True,
        )

    output = Candidate3OutputContract(
        decision=Candidate3Decision.ESTIMATE_ATO,
        estimand="ATO / overlap-population incremental conversion effect",
        estimate=point.estimate,
        interval_lower=lower,
        interval_upper=upper,
        target_population=build_ato_estimand_contract().target_population,
        full_population_ate=None,
        support_status=SupportStatus.ADEQUATE,
        finite_sample_status=FiniteSampleStatus.ADEQUATE,
        identification_statement=(
            "identified only conditional on declared pre-treatment observables and "
            "the frozen Candidate 3 causal assumptions"
        ),
        latent_confounding_statement=(
            "Candidate 3 does not solve latent confounding or unmeasured common causes"
        ),
    )
    return Candidate3Result(
        output=output,
        diagnostics=diagnostics,
        propensity_l2=propensity_l2,
        bootstrap_requested=requested,
        bootstrap_valid=len(bootstrap),
        feature_columns=prepared.feature_columns,
        provenance_valid=True,
    )


def point_estimate_for_development(
    case: Candidate3Case,
    *,
    propensity_l2: float,
) -> Candidate3Result:
    """Development-only point path; never used for frozen uncertainty evaluation."""
    x_contract = build_pretreatment_x_contract()
    support_contract = build_support_abstention_contract()
    uncertainty_contract = build_uncertainty_contract()
    try:
        prepared = prepare_case(case, x_contract)
    except ValueError:
        return Candidate3Result(
            output=_abstention_output(
                Candidate3Decision.ABSTAIN_PRETREATMENT_INVALID,
                support=SupportStatus.INADEQUATE,
                finite=FiniteSampleStatus.INADEQUATE,
            ),
            diagnostics=None,
            propensity_l2=propensity_l2,
            bootstrap_requested=0,
            bootstrap_valid=0,
            feature_columns=(),
            provenance_valid=False,
        )
    point = _point_pipeline(prepared, l2=propensity_l2)
    support = support_status(point.diagnostics, support_contract)
    finite = finite_sample_status(
        point.diagnostics,
        support_contract,
        uncertainty_contract,
    )
    decision = candidate3_decision(
        pretreatment_valid=True,
        diagnostics=point.diagnostics,
        support_contract=support_contract,
        uncertainty_contract=uncertainty_contract,
    )
    if not point.converged and decision == Candidate3Decision.ESTIMATE_ATO:
        decision = Candidate3Decision.ABSTAIN_INADEQUATE_FINITE_SAMPLE
    if decision == Candidate3Decision.ESTIMATE_ATO:
        output = Candidate3OutputContract(
            decision=decision,
            estimand="ATO / overlap-population incremental conversion effect",
            estimate=point.estimate,
            interval_lower=point.estimate,
            interval_upper=point.estimate,
            target_population=build_ato_estimand_contract().target_population,
            full_population_ate=None,
            support_status=support,
            finite_sample_status=finite,
            identification_statement=(
                "identified only conditional on declared pre-treatment observables and "
                "the frozen Candidate 3 causal assumptions"
            ),
            latent_confounding_statement=(
                "Candidate 3 does not solve latent confounding or unmeasured common causes"
            ),
        )
    else:
        output = _abstention_output(decision, support=support, finite=finite)
    return Candidate3Result(
        output=output,
        diagnostics=point.diagnostics,
        propensity_l2=propensity_l2,
        bootstrap_requested=0,
        bootstrap_valid=0,
        feature_columns=prepared.feature_columns,
        provenance_valid=True,
    )

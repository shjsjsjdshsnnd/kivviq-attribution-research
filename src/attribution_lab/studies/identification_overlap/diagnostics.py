from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

import numpy as np

from attribution_lab.studies.identification_overlap.features import DiagnosticData

DIAGNOSTIC_L2 = 1.0
N_FOLDS = 3
PROPENSITY_CLIP = 0.025
Z_90 = 1.6448536269514722


@dataclass(frozen=True, slots=True)
class RecoveryDiagnostics:
    effect_estimate: float
    standard_error: float
    interval_lower: float
    interval_upper: float
    absolute_error: float
    propensity_log_loss: float
    propensity_brier: float
    propensity_auc: float
    extreme_propensity_fraction: float
    treated_ess: float
    control_ess: float
    max_inverse_weight: float
    max_abs_smd_unweighted: float
    max_abs_smd_weighted: float
    numerically_valid: bool


@dataclass(frozen=True, slots=True)
class CellDiagnostics:
    truth: float
    observable: RecoveryDiagnostics
    oracle: RecoveryDiagnostics
    null_propensity_log_loss: float
    observable_predictability_gain: float
    oracle_predictability_gain: float
    information_log_loss_gap: float
    structural_unobserved_common_cause: bool


def _sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(values, -35.0, 35.0)))


def _fit_logistic(matrix: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, bool]:
    beta = np.zeros(matrix.shape[1], dtype=float)
    penalty = np.ones(matrix.shape[1], dtype=float)
    penalty[0] = 0.0
    converged = False
    for _ in range(80):
        probability = _sigmoid(matrix @ beta)
        weight = np.clip(probability * (1.0 - probability), 1e-6, None)
        gradient = matrix.T @ (target - probability) - DIAGNOSTIC_L2 * penalty * beta
        information = matrix.T @ (weight[:, None] * matrix)
        information += np.diag(DIAGNOSTIC_L2 * penalty + 1e-9)
        try:
            step = np.linalg.solve(information, gradient)
        except np.linalg.LinAlgError:
            step = np.linalg.lstsq(information, gradient, rcond=None)[0]
        largest = float(np.max(np.abs(step)))
        if largest > 2.0:
            step *= 2.0 / largest
        beta += step
        if float(np.max(np.abs(step))) < 1e-8:
            converged = True
            break
    return beta, converged


def _fold(subject_id: str) -> int:
    base = subject_id.split("-fragment-", 1)[0]
    digest = hashlib.sha256(base.encode()).digest()
    return int.from_bytes(digest[:4], "big") % N_FOLDS


def _crossfit(
    data: DiagnosticData,
    features: np.ndarray,
    *,
    true_propensity: np.ndarray | None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, bool]:
    n = len(data.subject_ids)
    prop = np.zeros(n, dtype=float)
    m1 = np.zeros(n, dtype=float)
    m0 = np.zeros(n, dtype=float)
    all_converged = True

    folds = np.asarray([_fold(subject_id) for subject_id in data.subject_ids], dtype=int)
    for fold in range(N_FOLDS):
        test = folds == fold
        train = ~test
        if not np.any(test):
            continue
        x_train = features[train]
        x_test = features[test]
        a_train = data.treatment[train]
        y_train = data.outcome[train]
        if len(np.unique(a_train)) < 2:
            all_converged = False
            prop[test] = float(np.mean(a_train)) if a_train.size else 0.5
        elif true_propensity is None:
            p_matrix = np.column_stack([np.ones(np.sum(train)), x_train])
            p_beta, p_converged = _fit_logistic(p_matrix, a_train)
            prop[test] = _sigmoid(
                np.column_stack([np.ones(np.sum(test)), x_test]) @ p_beta
            )
            all_converged = all_converged and p_converged
        else:
            prop[test] = true_propensity[test]

        o_matrix = np.column_stack(
            [np.ones(np.sum(train)), a_train, x_train]
        )
        o_beta, o_converged = _fit_logistic(o_matrix, y_train)
        treated = np.column_stack(
            [np.ones(np.sum(test)), np.ones(np.sum(test)), x_test]
        )
        untreated = np.column_stack(
            [np.ones(np.sum(test)), np.zeros(np.sum(test)), x_test]
        )
        m1[test] = _sigmoid(treated @ o_beta)
        m0[test] = _sigmoid(untreated @ o_beta)
        all_converged = all_converged and o_converged
    return prop, m1, m0, all_converged


def _log_loss(target: np.ndarray, probability: np.ndarray) -> float:
    p = np.clip(probability, 1e-9, 1.0 - 1e-9)
    return float(-np.mean(target * np.log(p) + (1.0 - target) * np.log(1.0 - p)))


def _auc(target: np.ndarray, score: np.ndarray) -> float:
    positives = score[target == 1.0]
    negatives = score[target == 0.0]
    if positives.size == 0 or negatives.size == 0:
        return 0.5
    comparisons = positives[:, None] - negatives[None, :]
    return float(
        (np.sum(comparisons > 0.0) + 0.5 * np.sum(comparisons == 0.0))
        / comparisons.size
    )


def _ess(weights: np.ndarray) -> float:
    if weights.size == 0:
        return 0.0
    total = float(np.sum(weights))
    denominator = float(np.sum(weights * weights))
    return 0.0 if denominator <= 0.0 else total * total / denominator


def _smd(
    features: np.ndarray,
    treatment: np.ndarray,
    weights: np.ndarray | None,
) -> float:
    treated = treatment == 1.0
    control = treatment == 0.0
    if not np.any(treated) or not np.any(control):
        return float("inf")
    result: list[float] = []
    for column in range(features.shape[1]):
        x = features[:, column]
        if weights is None:
            mean_t = float(np.mean(x[treated]))
            mean_c = float(np.mean(x[control]))
            var_t = float(np.var(x[treated]))
            var_c = float(np.var(x[control]))
        else:
            wt = weights[treated]
            wc = weights[control]
            mean_t = float(np.average(x[treated], weights=wt))
            mean_c = float(np.average(x[control], weights=wc))
            var_t = float(np.average((x[treated] - mean_t) ** 2, weights=wt))
            var_c = float(np.average((x[control] - mean_c) ** 2, weights=wc))
        pooled = math.sqrt(max((var_t + var_c) / 2.0, 1e-12))
        result.append(abs(mean_t - mean_c) / pooled)
    return max(result, default=0.0)


def _recovery(
    data: DiagnosticData,
    features: np.ndarray,
    *,
    truth: float,
    true_propensity: np.ndarray | None,
) -> RecoveryDiagnostics:
    prop, m1, m0, converged = _crossfit(
        data,
        features,
        true_propensity=true_propensity,
    )
    clipped = np.clip(prop, PROPENSITY_CLIP, 1.0 - PROPENSITY_CLIP)
    a = data.treatment
    y = data.outcome
    pseudo = (
        m1
        - m0
        + a * (y - m1) / clipped
        - (1.0 - a) * (y - m0) / (1.0 - clipped)
    )
    effect = float(np.mean(pseudo))
    se = float(np.std(pseudo, ddof=1) / math.sqrt(len(pseudo))) if len(pseudo) > 1 else float("inf")
    treated_weights = 1.0 / clipped[a == 1.0]
    control_weights = 1.0 / (1.0 - clipped[a == 0.0])
    balancing_weights = np.where(a == 1.0, 1.0 / clipped, 1.0 / (1.0 - clipped))
    finite = bool(
        converged
        and np.all(np.isfinite(prop))
        and np.all(np.isfinite(pseudo))
        and math.isfinite(se)
    )
    return RecoveryDiagnostics(
        effect_estimate=effect,
        standard_error=se,
        interval_lower=effect - Z_90 * se,
        interval_upper=effect + Z_90 * se,
        absolute_error=abs(effect - truth),
        propensity_log_loss=_log_loss(a, prop),
        propensity_brier=float(np.mean((a - prop) ** 2)),
        propensity_auc=_auc(a, prop),
        extreme_propensity_fraction=float(
            np.mean((prop < PROPENSITY_CLIP) | (prop > 1.0 - PROPENSITY_CLIP))
        ),
        treated_ess=_ess(treated_weights),
        control_ess=_ess(control_weights),
        max_inverse_weight=max(
            float(np.max(treated_weights)) if treated_weights.size else float("inf"),
            float(np.max(control_weights)) if control_weights.size else float("inf"),
        ),
        max_abs_smd_unweighted=_smd(features, a, None),
        max_abs_smd_weighted=_smd(features, a, balancing_weights),
        numerically_valid=finite,
    )


def diagnose(
    data: DiagnosticData,
    *,
    truth: float,
    selection_strength: float,
    latent_intent_weight: float,
) -> CellDiagnostics:
    observable = _recovery(
        data,
        data.observable_features,
        truth=truth,
        true_propensity=None,
    )
    oracle = _recovery(
        data,
        data.oracle_features,
        truth=truth,
        true_propensity=data.true_propensity,
    )
    prevalence = min(max(float(np.mean(data.treatment)), 1e-6), 1.0 - 1e-6)
    null_probability = np.full(data.treatment.shape, prevalence)
    null_log_loss = _log_loss(data.treatment, null_probability)
    return CellDiagnostics(
        truth=truth,
        observable=observable,
        oracle=oracle,
        null_propensity_log_loss=null_log_loss,
        observable_predictability_gain=null_log_loss - observable.propensity_log_loss,
        oracle_predictability_gain=null_log_loss - oracle.propensity_log_loss,
        information_log_loss_gap=observable.propensity_log_loss - oracle.propensity_log_loss,
        structural_unobserved_common_cause=(
            abs(selection_strength) > 1e-12 and abs(latent_intent_weight) > 1e-12
        ),
    )

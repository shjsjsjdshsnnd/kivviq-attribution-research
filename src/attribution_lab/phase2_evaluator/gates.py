from __future__ import annotations

from dataclasses import dataclass

from attribution_lab.phase2_evaluator.results import (
    GateOutcome,
    ScenarioStatus,
    SeparatedEvaluationReport,
)
from phase2_candidate_sdk import CandidateDeclaration, FamilyCriterion


@dataclass(frozen=True, slots=True)
class GateDecision:
    outcome: GateOutcome
    reasons: tuple[str, ...]


def _passes(value: float, criterion: FamilyCriterion) -> bool:
    if criterion.operator == "lte":
        return value <= criterion.threshold
    if criterion.operator == "lt":
        return value < criterion.threshold
    if criterion.operator == "gte":
        return value >= criterion.threshold
    return value > criterion.threshold


def apply_preregistered_gate(
    report: SeparatedEvaluationReport,
    declaration: CandidateDeclaration,
) -> GateDecision:
    """Apply candidate-specific rules without blending stage or family scores."""
    criteria = declaration.falsification_criteria
    by_family = {result.family: result for result in report.sealed_holdout_results}
    reasons: list[str] = []
    missing: list[str] = []
    required = set(criteria.required_holdout_families)
    unexpected = sorted(set(by_family) - required)
    if unexpected:
        missing.append(
            "holdout suite contains families not preregistered for this candidate version: "
            + ", ".join(unexpected)
        )

    for family in criteria.required_holdout_families:
        result = by_family.get(family)
        if result is None:
            missing.append(f"missing required holdout family: {family}")
            continue
        if result.status in {
            ScenarioStatus.UNSUPPORTED,
            ScenarioStatus.INVALID_OUTPUT,
            ScenarioStatus.ERROR,
        }:
            reasons.append(f"{family}: required holdout status is {result.status}")
            continue
        if criteria.uncertainty_requirements and not result.uncertainty_present:
            reasons.append(f"{family}: required uncertainty output is missing")

        metrics = dict(result.metrics)
        family_rules = [rule for rule in criteria.family_rules if rule.family == family]
        for rule in family_rules:
            if rule.metric not in metrics:
                reasons.append(f"{family}: required metric {rule.metric} is missing")
                continue
            if not _passes(metrics[rule.metric], rule):
                reasons.append(
                    f"{family}: {rule.metric} failed preregistered {rule.operator} "
                    f"{rule.threshold}"
                )

    if reasons:
        return GateDecision(GateOutcome.REJECT, tuple(reasons))
    if missing:
        return GateDecision(GateOutcome.INCONCLUSIVE, tuple(missing))
    return GateDecision(GateOutcome.SURVIVE, ())

from __future__ import annotations

from .model import (
    AnswerContract,
    EvidenceConflict,
    EvidenceFact,
    ExpectedOutcome,
    FailureClass,
    FreshnessState,
    MeasurementStatus,
    ProposedAnswer,
    ValidationResult,
)


ABSOLUTE_CONFLICT_TOLERANCE = 0.01
RELATIVE_CONFLICT_TOLERANCE = 0.005


def _same_fact_identity(left: EvidenceFact, right: EvidenceFact) -> bool:
    return (
        left.metric_id == right.metric_id
        and left.source == right.source
        and left.scope == right.scope
        and left.served_range == right.served_range
        and left.currency == right.currency
        and left.breakdown_dimension == right.breakdown_dimension
        and left.attribution_basis == right.attribution_basis
        and left.profit_basis == right.profit_basis
    )


def _materially_disagree(left: object, right: object) -> bool:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        scale = max(abs(float(left)), abs(float(right)), 1.0)
        tolerance = max(ABSOLUTE_CONFLICT_TOLERANCE, RELATIVE_CONFLICT_TOLERANCE * scale)
        return abs(float(left) - float(right)) > tolerance
    return left != right


def _detect_conflicts(facts: tuple[EvidenceFact, ...]) -> tuple[EvidenceConflict, ...]:
    conflicts: list[EvidenceConflict] = []
    usable = tuple(
        fact
        for fact in facts
        if fact.measurement_status in {MeasurementStatus.MEASURED, MeasurementStatus.ESTIMATED, MeasurementStatus.DEGRADED}
        and fact.value is not None
    )
    consumed: set[int] = set()
    for index, fact in enumerate(usable):
        if index in consumed:
            continue
        group = [fact]
        for other_index in range(index + 1, len(usable)):
            other = usable[other_index]
            if _same_fact_identity(fact, other):
                group.append(other)
                consumed.add(other_index)
        if len(group) < 2:
            continue
        values = tuple(item.value for item in group)
        first = values[0]
        if any(_materially_disagree(first, value) for value in values[1:]):
            conflicts.append(
                EvidenceConflict(
                    metric_id=fact.metric_id,
                    source=fact.source,
                    scope=fact.scope,
                    period=fact.served_range,
                    values=values,
                    fact_count=len(group),
                )
            )
    return tuple(conflicts)


class EvidenceGovernor:
    """Validate proposed claims against explicit evidence contracts."""

    def validate(self, answer: ProposedAnswer, contract: AnswerContract) -> ValidationResult:
        if contract.outcome is ExpectedOutcome.AMBIGUOUS:
            return ValidationResult(ExpectedOutcome.AMBIGUOUS, False)

        if contract.outcome is ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM:
            has_causal = any(f.supports_causality for f in answer.evidence)
            if not has_causal:
                return ValidationResult(
                    ExpectedOutcome.UNSUPPORTED_CAUSAL_CLAIM,
                    False,
                    (FailureClass.UNSUPPORTED_CAUSALITY,),
                )

        failures: list[FailureClass] = []
        notes: list[str] = []
        facts = answer.evidence
        conflicts = _detect_conflicts(facts)
        if conflicts:
            return ValidationResult(
                ExpectedOutcome.CONFLICT,
                False,
                (FailureClass.EVIDENCE_CONFLICT,),
                ("authoritative evidence conflict blocks a definitive answer",),
                conflicts,
            )

        if contract.required_metric is not None and answer.metric_id != contract.required_metric:
            failures.append(FailureClass.WRONG_METRIC)
            if {answer.metric_id, contract.required_metric} <= {"gross_sales", "net_sales", "total_sales"}:
                failures.append(FailureClass.GROSS_NET_TOTAL_CONFUSION)
            if answer.metric_id in {"platform_attributed_revenue", "analytics_revenue", "first_party_linked_revenue"} and contract.required_metric in {"gross_sales", "net_sales", "total_sales"}:
                failures.append(FailureClass.ATTRIBUTED_AS_STORE_REVENUE)

        if contract.required_scope is not None and answer.scope != contract.required_scope:
            failures.append(FailureClass.WRONG_SCOPE)

        if contract.required_period is not None and answer.period != contract.required_period:
            failures.append(FailureClass.WRONG_PERIOD)

        if contract.breakdown_dimension != answer.breakdown_dimension:
            failures.append(FailureClass.WRONG_BREAKDOWN)

        if answer.calculation and answer.calculation not in contract.permitted_calculations:
            failures.append(FailureClass.UNSUPPORTED_CALCULATION)

        missing_caveats = set(contract.required_caveats) - set(answer.caveats)
        if missing_caveats:
            failures.append(FailureClass.MISSING_CAVEAT)

        if not facts and contract.required_metric is not None:
            return ValidationResult(ExpectedOutcome.INSUFFICIENT_EVIDENCE, False, tuple(failures or [FailureClass.EVIDENCE_AVAILABLE_BUT_REJECTED]))

        # Breakdown evidence may contain component scopes/sources. The answer-level contract
        # carries the parent scope while facts carry each component.
        for fact in facts:
            if fact.measurement_status is MeasurementStatus.NULL:
                if answer.value == 0:
                    failures.append(FailureClass.NULL_AS_ZERO)
                else:
                    failures.append(FailureClass.EVIDENCE_AVAILABLE_BUT_REJECTED)
            if fact.measurement_status is MeasurementStatus.UNAVAILABLE and fact.value is not None:
                failures.append(FailureClass.NULL_AS_ZERO)
            try:
                fact.validate()
            except ValueError:
                failures.append(FailureClass.UNSUPPORTED_CALCULATION)
                continue
            if contract.required_metric is not None and fact.metric_id != contract.required_metric:
                failures.append(FailureClass.WRONG_METRIC)
            if contract.required_source is not None and fact.source != contract.required_source:
                failures.append(FailureClass.WRONG_SOURCE)
            if contract.required_period is not None and fact.served_range != contract.required_period:
                failures.append(FailureClass.WRONG_PERIOD)
            if contract.require_fresh and fact.freshness is not FreshnessState.FRESH:
                failures.append(FailureClass.STALE_EVIDENCE)
            if contract.attribution_basis is not None and fact.attribution_basis not in {None, contract.attribution_basis}:
                failures.append(FailureClass.WRONG_SOURCE)
            if contract.profit_basis is not None and fact.profit_basis not in {None, contract.profit_basis}:
                failures.append(FailureClass.UNSUPPORTED_PROFIT)
            if contract.required_cost_inputs:
                available_inputs = set(fact.quality.get("cost_inputs", ()))
                if not set(contract.required_cost_inputs).issubset(available_inputs):
                    failures.append(FailureClass.UNSUPPORTED_PROFIT)

        if contract.require_ordered_journey and not all(f.supports_ordered_journey for f in facts):
            failures.append(FailureClass.FABRICATED_JOURNEY)
        if answer.claims_ordered_journey and not all(f.supports_ordered_journey for f in facts):
            failures.append(FailureClass.FABRICATED_JOURNEY)
        if answer.claims_causality and not any(f.supports_causality for f in facts):
            failures.append(FailureClass.UNSUPPORTED_CAUSALITY)

        if contract.required_sources:
            present_sources = {f.source for f in facts if f.measurement_status is not MeasurementStatus.UNAVAILABLE}
            missing_sources = set(contract.required_sources) - present_sources
            if missing_sources and contract.require_full_coverage:
                return ValidationResult(
                    ExpectedOutcome.SOURCE_DEGRADED, False,
                    tuple(dict.fromkeys(failures + [FailureClass.PROVIDER_FAILURE_CONTAMINATION])),
                    ("missing required provider coverage",),
                )

        if any(f.measurement_status is MeasurementStatus.NULL for f in facts):
            return ValidationResult(ExpectedOutcome.INSUFFICIENT_EVIDENCE, False, tuple(dict.fromkeys(failures)))

        if any(f.measurement_status is MeasurementStatus.UNAVAILABLE for f in facts):
            available = [f for f in facts if f.measurement_status is not MeasurementStatus.UNAVAILABLE]
            if not available:
                return ValidationResult(ExpectedOutcome.UNAVAILABLE, False, tuple(dict.fromkeys(failures)))
            if contract.require_full_coverage:
                return ValidationResult(ExpectedOutcome.SOURCE_DEGRADED, False, tuple(dict.fromkeys(failures + [FailureClass.PROVIDER_FAILURE_CONTAMINATION])))
            notes.append("partial provider coverage")
            return ValidationResult(ExpectedOutcome.SUPPORTED_PARTIAL, True, tuple(dict.fromkeys(failures)), tuple(notes))

        if any(f.measurement_status is MeasurementStatus.DEGRADED for f in facts):
            if contract.require_full_coverage:
                return ValidationResult(ExpectedOutcome.SOURCE_DEGRADED, False, tuple(dict.fromkeys(failures)))
            notes.append("degraded provider coverage")
            return ValidationResult(ExpectedOutcome.SUPPORTED_PARTIAL, True, tuple(dict.fromkeys(failures)), tuple(notes))

        if contract.require_fresh and any(f.freshness is FreshnessState.STALE for f in facts):
            return ValidationResult(ExpectedOutcome.STALE, False, tuple(dict.fromkeys(failures or [FailureClass.STALE_EVIDENCE])))

        if failures:
            unique = tuple(dict.fromkeys(failures))
            if FailureClass.WRONG_PERIOD in unique:
                return ValidationResult(ExpectedOutcome.PERIOD_MISMATCH, False, unique)
            if FailureClass.WRONG_SCOPE in unique:
                return ValidationResult(ExpectedOutcome.SCOPE_MISMATCH, False, unique)
            return ValidationResult(ExpectedOutcome.INSUFFICIENT_EVIDENCE, False, unique)

        if any(f.measurement_status is MeasurementStatus.ESTIMATED for f in facts):
            return ValidationResult(ExpectedOutcome.SUPPORTED_ESTIMATE, True)
        return ValidationResult(ExpectedOutcome.SUPPORTED_EXACT, True, notes=tuple(notes))

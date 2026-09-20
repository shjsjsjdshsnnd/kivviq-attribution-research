from __future__ import annotations

from collections import Counter

from ..model import RequestSemantics
from .contracts import SemanticBundle, SemanticResolverCandidate
from .development import DEVELOPMENT_VERSION, REFERENCE, generate_development_cases


def _request_slots(
    expected: SemanticBundle,
    actual: SemanticBundle,
) -> tuple[tuple[RequestSemantics, RequestSemantics | None], ...]:
    return tuple(
        (request, actual.requests[index] if index < len(actual.requests) else None)
        for index, request in enumerate(expected.requests)
    )


def evaluate_development(candidate: SemanticResolverCandidate) -> dict[str, object]:
    cases = generate_development_cases()
    exact = 0
    by_language: Counter[str] = Counter()
    language_passes: Counter[str] = Counter()
    fields = ("metric", "source_provider", "scope", "period", "breakdown_dimension")
    field_hits: Counter[str] = Counter()
    field_total = 0

    for case in cases:
        actual = candidate.resolve(case.message, REFERENCE)
        passed = actual == case.expected
        exact += int(passed)
        by_language[case.language] += 1
        language_passes[case.language] += int(passed)
        for expected_request, actual_request in _request_slots(case.expected, actual):
            field_total += 1
            if actual_request is None:
                continue
            for field in fields:
                field_hits[field] += int(getattr(actual_request, field) == getattr(expected_request, field))

    denominator = max(field_total, 1)
    return {
        "candidate": candidate.name,
        "suite_version": DEVELOPMENT_VERSION,
        "cases": len(cases),
        "exact_semantic_accuracy": exact / len(cases),
        **{f"{field}_accuracy": field_hits[field] / denominator for field in fields},
        "language_accuracy": {
            language: language_passes[language] / count for language, count in sorted(by_language.items())
        },
    }

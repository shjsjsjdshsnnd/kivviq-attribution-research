"""Candidate-visible Phase 2 contracts.

This package is intentionally independent from attribution_lab so the evaluator
can copy only this SDK into an isolated candidate execution workspace.
"""

from phase2_candidate_sdk.contracts import (
    CandidateDeclaration,
    CandidateResponse,
    DeclaredContext,
    EstimandDefinition,
    EstimandKind,
    FamilyCriterion,
    FalsificationCriteria,
    ObservableConversion,
    ObservableDataset,
    ObservableJourney,
    ObservableSession,
    ObservableTouchpoint,
    UncertaintyOutput,
    fingerprint_payload,
    validate_candidate_response,
)

__all__ = [
    "CandidateDeclaration",
    "CandidateResponse",
    "DeclaredContext",
    "EstimandDefinition",
    "EstimandKind",
    "FamilyCriterion",
    "FalsificationCriteria",
    "ObservableConversion",
    "ObservableDataset",
    "ObservableJourney",
    "ObservableSession",
    "ObservableTouchpoint",
    "UncertaintyOutput",
    "fingerprint_payload",
    "validate_candidate_response",
]

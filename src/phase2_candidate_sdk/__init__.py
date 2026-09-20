"""Candidate-visible Phase 2 contracts.

This package is intentionally independent from attribution_lab so the evaluator
can copy only this SDK into an isolated candidate execution workspace.
"""

from phase2_candidate_sdk import contracts as _contracts

CandidateDeclaration = _contracts.CandidateDeclaration
CandidateResponse = _contracts.CandidateResponse
DeclaredContext = _contracts.DeclaredContext
EstimandDefinition = _contracts.EstimandDefinition
EstimandKind = _contracts.EstimandKind
FamilyCriterion = _contracts.FamilyCriterion
FalsificationCriteria = _contracts.FalsificationCriteria
ObservableConversion = _contracts.ObservableConversion
ObservableDataset = _contracts.ObservableDataset
ObservableJourney = _contracts.ObservableJourney
ObservableSession = _contracts.ObservableSession
ObservableTouchpoint = _contracts.ObservableTouchpoint
UncertaintyOutput = _contracts.UncertaintyOutput
fingerprint_payload = _contracts.fingerprint_payload
validate_candidate_response = _contracts.validate_candidate_response

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

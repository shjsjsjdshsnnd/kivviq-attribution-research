"""Candidate semantic resolvers.

Candidate modules must not import evaluator-only Phase 2 holdout packages.
"""

from .deterministic import DeterministicResolverCandidate
from .model_based import ModelBasedResolverCandidate

__all__ = ["DeterministicResolverCandidate", "ModelBasedResolverCandidate"]

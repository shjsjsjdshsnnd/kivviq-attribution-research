from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from ..model import RequestSemantics


@dataclass(frozen=True)
class SemanticBundle:
    """One or more typed semantic requests extracted from a merchant message."""

    requests: tuple[RequestSemantics, ...]


class SemanticResolverCandidate(Protocol):
    """Candidate-facing contract. Holdout/evaluator details are intentionally absent."""

    name: str

    def resolve(
        self,
        message: str,
        reference: datetime,
        context: tuple[RequestSemantics, ...] = (),
    ) -> SemanticBundle:
        ...


class ModelSemanticBackend(Protocol):
    """Backend contract for an external model-backed structured semantic resolver."""

    def infer(
        self,
        message: str,
        reference: datetime,
        context: tuple[RequestSemantics, ...],
    ) -> SemanticBundle:
        ...


class StructuredTextModel(Protocol):
    """Text model boundary used by Candidate 1.

    The backend receives interpretation instructions and merchant language only.
    It does not receive evidence facts, governor outcomes, or holdout truth.
    """

    model_id: str

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        ...

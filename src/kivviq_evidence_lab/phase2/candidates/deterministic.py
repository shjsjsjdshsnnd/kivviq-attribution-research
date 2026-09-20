from __future__ import annotations

from datetime import datetime

from ...model import RequestSemantics
from ...semantics import SemanticResolver
from ..contracts import SemanticBundle


class DeterministicResolverCandidate:
    """Frozen Phase 1 resolver exposed through the Phase 2 candidate contract."""

    name = "phase1-deterministic-v1"

    def __init__(self) -> None:
        self._resolver = SemanticResolver()

    def resolve(
        self,
        message: str,
        reference: datetime,
        context: tuple[RequestSemantics, ...] = (),
    ) -> SemanticBundle:
        previous = context[-1] if context else None
        request = self._resolver.resolve(message, reference, previous)
        return SemanticBundle((request,))

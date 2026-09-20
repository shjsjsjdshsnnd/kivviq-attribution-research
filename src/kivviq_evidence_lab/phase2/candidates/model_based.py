from __future__ import annotations

from datetime import datetime

from ...model import RequestSemantics
from ..contracts import ModelSemanticBackend, SemanticBundle


class ModelBasedResolverCandidate:
    """Adapter for a model backend that returns typed RequestSemantics.

    The model may interpret language but it does not receive evidence-governor
    authority and cannot import or execute evaluator-only holdouts.
    """

    name = "model-based-interface-v1"

    def __init__(self, backend: ModelSemanticBackend) -> None:
        self._backend = backend

    def resolve(
        self,
        message: str,
        reference: datetime,
        context: tuple[RequestSemantics, ...] = (),
    ) -> SemanticBundle:
        bundle = self._backend.infer(message, reference, context)
        if not isinstance(bundle, SemanticBundle):
            raise TypeError("model backend must return SemanticBundle")
        if not all(isinstance(request, RequestSemantics) for request in bundle.requests):
            raise TypeError("model backend returned an invalid semantic request")
        return bundle

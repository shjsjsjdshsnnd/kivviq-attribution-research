from __future__ import annotations

from collections.abc import Iterable

from .model import EvidenceFact, RequestSemantics
from .registry import MetricRegistry
from .world import AD_PROVIDERS


class EvidenceRetriever:
    """Select candidate facts using metric authority without semantic substitution."""

    def __init__(self, registry: MetricRegistry | None = None) -> None:
        self.registry = registry or MetricRegistry()

    def select(self, request: RequestSemantics, candidates: Iterable[EvidenceFact]) -> tuple[EvidenceFact, ...]:
        if request.metric is None or request.period is None:
            return ()
        authority = self.registry.authoritative_source(request.metric, request.source_provider)
        selected: list[EvidenceFact] = []
        for fact in candidates:
            if fact.metric_id != request.metric:
                continue
            if fact.served_range != request.period:
                continue
            if request.scope == "all_ad_providers":
                if fact.source not in AD_PROVIDERS:
                    continue
            elif authority is not None and fact.source != authority:
                continue
            if request.breakdown_dimension is None and request.scope not in {"all_ad_providers", "all_channels"}:
                if fact.scope != request.scope:
                    continue
            if request.breakdown_dimension is not None and fact.breakdown_dimension != request.breakdown_dimension:
                continue
            selected.append(fact)
        return tuple(selected)

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from attribution_lab.phase2.constants import EVALUATION_PROTOCOL_VERSION
from attribution_lab.phase2.registration import (
    CandidateRegistry,
    RegisteredCandidate,
)
from attribution_lab.phase2_evaluator.ledger import (
    HoldoutExposureEventType,
    HoldoutExposureLedgerEntry,
    ResearchLedger,
)
from phase2_candidate_sdk import CandidateDeclaration


class HoldoutExposureConsumed(RuntimeError):
    pass


class AuditReplayNotAllowed(RuntimeError):
    pass


class AuditReplayIntegrityError(RuntimeError):
    pass


EVALUATION_PROHIBITED_PRIOR_EXPOSURE = "EVALUATION_PROHIBITED_PRIOR_EXPOSURE"


class EvaluationProhibitedPriorExposure(RuntimeError):
    """Raised when an already-exposed frozen lineage is assigned a repaired holdout."""


class RetrospectiveCandidateOutcomeUpgradeProhibited(RuntimeError):
    """Raised when family observations are used to rewrite Candidate 3's outcome."""


_CANDIDATE3_V1_LINEAGE_FINGERPRINT = (
    "1571c29726e79154c2d9bc9016909ab7ab04540fe24cf63a62e0f46b66288620"
)
_CANDIDATE3_V1_COMBINED_CODE_FINGERPRINT = (
    "1a611d8777bc502ed4912b1fd98f7dae5009c834f3fa5e8a6dde5e0fdaac3522"
)
_CANDIDATE3_V1_CONTRACT_MANIFEST_FINGERPRINT = (
    "f760212ad3066bb266650fc0c7737f999a8f0c455d89f18a8c30526c2cbc983c"
)
_CANDIDATE3_HOLDOUT_V2 = "candidate3-holdout-v2"


def assert_candidate3_v2_evaluation_permitted(
    *,
    candidate_id: str,
    candidate_version: str,
    lineage_fingerprint: str,
    combined_code_fingerprint: str,
    contract_manifest_fingerprint: str,
    holdout_version: str,
) -> None:
    """Reject Candidate 3 v1's frozen substance, independent of its display name.

    All three frozen fingerprints are required so a label or version alias cannot
    create another feedback-bearing exposure to the repaired benchmark.
    """
    del candidate_id, candidate_version
    is_candidate3_v1_substance = (
        lineage_fingerprint == _CANDIDATE3_V1_LINEAGE_FINGERPRINT
        and combined_code_fingerprint == _CANDIDATE3_V1_COMBINED_CODE_FINGERPRINT
        and contract_manifest_fingerprint
        == _CANDIDATE3_V1_CONTRACT_MANIFEST_FINGERPRINT
    )
    if holdout_version == _CANDIDATE3_HOLDOUT_V2 and is_candidate3_v1_substance:
        raise EvaluationProhibitedPriorExposure(EVALUATION_PROHIBITED_PRIOR_EXPOSURE)


def _assert_registered_candidate3_v2_evaluation_permitted(
    identity: RegisteredCandidate,
    holdout_version: str,
) -> None:
    """Apply the prohibition at the feedback-consumption boundary.

    Registry lineage is derived from the frozen declaration, candidate source,
    and development record, excluding only display ID/version aliases.
    """
    if (
        holdout_version == _CANDIDATE3_HOLDOUT_V2
        and identity.lineage_fingerprint == _CANDIDATE3_V1_LINEAGE_FINGERPRINT
    ):
        raise EvaluationProhibitedPriorExposure(EVALUATION_PROHIBITED_PRIOR_EXPOSURE)


def assert_candidate3_outcome_not_retroactively_upgraded(outcome: str) -> None:
    """Candidate 3's invalid complete gate fixes its candidate-level outcome."""
    if outcome != "INCONCLUSIVE":
        raise RetrospectiveCandidateOutcomeUpgradeProhibited(
            "Candidate 3 v1 family evidence cannot upgrade INCONCLUSIVE"
        )


@dataclass(frozen=True, slots=True)
class AuditReplayReceipt:
    label: str
    holdout_version: str
    evaluation_protocol_version: str
    integrity_match: bool


class HoldoutExposureController:
    def __init__(self, registry: CandidateRegistry, ledger: ResearchLedger) -> None:
        self.registry = registry
        self.ledger = ledger

    def consume_feedback(
        self,
        declaration: CandidateDeclaration,
        source: str,
        holdout_version: str,
        *,
        protocol_version: str = EVALUATION_PROTOCOL_VERSION,
        event_timestamp: str | None = None,
    ) -> RegisteredCandidate:
        identity = self.registry.validate_frozen(declaration, source)
        _assert_registered_candidate3_v2_evaluation_permitted(identity, holdout_version)
        for event in self.ledger.exposure_entries():
            same_holdout = (
                event.holdout_version == holdout_version
                and event.evaluation_protocol_version == protocol_version
            )
            if (
                same_holdout
                and event.event_type == HoldoutExposureEventType.FEEDBACK_CONSUMED
                and event.lineage_fingerprint == identity.lineage_fingerprint
            ):
                raise HoldoutExposureConsumed(
                    "sealed holdout feedback has already been consumed for this "
                    "candidate lineage/version"
                )

        self.ledger.append(
            HoldoutExposureLedgerEntry(
                event_type=HoldoutExposureEventType.FEEDBACK_CONSUMED,
                candidate_id=identity.candidate_id,
                candidate_version=identity.version,
                lineage_fingerprint=identity.lineage_fingerprint,
                declaration_fingerprint=identity.declaration_fingerprint,
                code_fingerprint=identity.code_fingerprint,
                development_record_fingerprint=identity.development_record_fingerprint,
                holdout_version=holdout_version,
                evaluation_protocol_version=protocol_version,
                event_timestamp=event_timestamp or datetime.now(UTC).isoformat(),
                result_digest=None,
                label="FEEDBACK_BEARING_EVALUATION_CONSUMED",
            )
        )
        return identity

    def record_feedback_result(
        self,
        identity: RegisteredCandidate,
        holdout_version: str,
        result_digest: str,
        *,
        protocol_version: str = EVALUATION_PROTOCOL_VERSION,
        event_timestamp: str | None = None,
    ) -> None:
        if not self._has_exact_consumption(identity, holdout_version, protocol_version):
            raise AuditReplayNotAllowed("feedback result cannot precede consumption")
        if self._feedback_result_digest(identity, holdout_version, protocol_version) is not None:
            raise HoldoutExposureConsumed("feedback result has already been recorded")
        self.ledger.append(
            HoldoutExposureLedgerEntry(
                event_type=HoldoutExposureEventType.FEEDBACK_RESULT,
                candidate_id=identity.candidate_id,
                candidate_version=identity.version,
                lineage_fingerprint=identity.lineage_fingerprint,
                declaration_fingerprint=identity.declaration_fingerprint,
                code_fingerprint=identity.code_fingerprint,
                development_record_fingerprint=identity.development_record_fingerprint,
                holdout_version=holdout_version,
                evaluation_protocol_version=protocol_version,
                event_timestamp=event_timestamp or datetime.now(UTC).isoformat(),
                result_digest=result_digest,
                label="FEEDBACK_RESULT_FROZEN",
            )
        )

    def expected_audit_digest(
        self,
        declaration: CandidateDeclaration,
        source: str,
        holdout_version: str,
        *,
        protocol_version: str = EVALUATION_PROTOCOL_VERSION,
    ) -> tuple[RegisteredCandidate, str]:
        identity = self.registry.validate_frozen(declaration, source)
        digest = self._feedback_result_digest(
            identity,
            holdout_version,
            protocol_version,
        )
        if digest is None:
            raise AuditReplayNotAllowed(
                "audit replay requires one completed feedback-bearing evaluation"
            )
        return identity, digest

    def record_audit_replay(
        self,
        identity: RegisteredCandidate,
        holdout_version: str,
        result_digest: str,
        *,
        protocol_version: str = EVALUATION_PROTOCOL_VERSION,
        event_timestamp: str | None = None,
    ) -> None:
        self.ledger.append(
            HoldoutExposureLedgerEntry(
                event_type=HoldoutExposureEventType.AUDIT_REPLAY,
                candidate_id=identity.candidate_id,
                candidate_version=identity.version,
                lineage_fingerprint=identity.lineage_fingerprint,
                declaration_fingerprint=identity.declaration_fingerprint,
                code_fingerprint=identity.code_fingerprint,
                development_record_fingerprint=identity.development_record_fingerprint,
                holdout_version=holdout_version,
                evaluation_protocol_version=protocol_version,
                event_timestamp=event_timestamp or datetime.now(UTC).isoformat(),
                result_digest=result_digest,
                label="AUDIT_REPLAY",
            )
        )

    def _has_exact_consumption(
        self,
        identity: RegisteredCandidate,
        holdout_version: str,
        protocol_version: str,
    ) -> bool:
        return any(
            event.event_type == HoldoutExposureEventType.FEEDBACK_CONSUMED
            and event.candidate_id == identity.candidate_id
            and event.candidate_version == identity.version
            and event.declaration_fingerprint == identity.declaration_fingerprint
            and event.code_fingerprint == identity.code_fingerprint
            and event.holdout_version == holdout_version
            and event.evaluation_protocol_version == protocol_version
            for event in self.ledger.exposure_entries()
        )

    def _feedback_result_digest(
        self,
        identity: RegisteredCandidate,
        holdout_version: str,
        protocol_version: str,
    ) -> str | None:
        matches = [
            event.result_digest
            for event in self.ledger.exposure_entries()
            if event.event_type == HoldoutExposureEventType.FEEDBACK_RESULT
            and event.candidate_id == identity.candidate_id
            and event.candidate_version == identity.version
            and event.declaration_fingerprint == identity.declaration_fingerprint
            and event.code_fingerprint == identity.code_fingerprint
            and event.holdout_version == holdout_version
            and event.evaluation_protocol_version == protocol_version
        ]
        if not matches:
            return None
        if len(matches) != 1 or matches[0] is None:
            raise AuditReplayNotAllowed("feedback-result ledger state is invalid")
        return matches[0]

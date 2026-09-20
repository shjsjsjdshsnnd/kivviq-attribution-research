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

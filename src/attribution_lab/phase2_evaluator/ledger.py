from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any


class LedgerIntegrityError(RuntimeError):
    pass


class HoldoutExposureEventType(StrEnum):
    FEEDBACK_CONSUMED = "FEEDBACK_CONSUMED"
    FEEDBACK_RESULT = "FEEDBACK_RESULT"
    AUDIT_REPLAY = "AUDIT_REPLAY"


def _canonical(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def _hash(payload: Any) -> str:
    return hashlib.sha256(_canonical(payload).encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class EvaluationLedgerEntry:
    candidate_id: str
    candidate_version: str
    estimand_declaration_fingerprint: str
    hypothesis_fingerprint: str
    candidate_code_fingerprint: str
    development_world_record_fingerprint: str
    phase1_reference: str
    holdout_version: str
    evaluation_timestamp: str
    evaluation_protocol_version: str
    results: tuple[tuple[str, str], ...]
    uncertainty: tuple[tuple[str, str], ...]
    robustness_results: tuple[tuple[str, str], ...]
    outcome: str
    rejection_reasons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class HoldoutExposureLedgerEntry:
    event_type: HoldoutExposureEventType
    candidate_id: str
    candidate_version: str
    lineage_fingerprint: str
    declaration_fingerprint: str
    code_fingerprint: str
    development_record_fingerprint: str
    holdout_version: str
    evaluation_protocol_version: str
    event_timestamp: str
    result_digest: str | None = None
    label: str | None = None


LedgerEntry = EvaluationLedgerEntry | HoldoutExposureLedgerEntry


class ResearchLedger:
    """Append-only hash-chained synthetic research history."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, entry: LedgerEntry) -> str:
        previous_hash = self._last_hash()
        body = {
            "entry_type": type(entry).__name__,
            "entry": asdict(entry),
            "previous_hash": previous_hash,
        }
        entry_hash = _hash(body)
        record = {**body, "entry_hash": entry_hash}
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(_canonical(record) + "\n")
        return entry_hash

    def records(self) -> tuple[dict[str, Any], ...]:
        self.verify()
        return tuple(self._records())

    def exposure_entries(self) -> tuple[HoldoutExposureLedgerEntry, ...]:
        entries: list[HoldoutExposureLedgerEntry] = []
        for record in self.records():
            if record.get("entry_type") != "HoldoutExposureLedgerEntry":
                continue
            payload = record.get("entry")
            if not isinstance(payload, dict):
                raise LedgerIntegrityError("holdout exposure ledger entry is invalid")
            entries.append(
                HoldoutExposureLedgerEntry(
                    event_type=HoldoutExposureEventType(str(payload["event_type"])),
                    candidate_id=str(payload["candidate_id"]),
                    candidate_version=str(payload["candidate_version"]),
                    lineage_fingerprint=str(payload["lineage_fingerprint"]),
                    declaration_fingerprint=str(payload["declaration_fingerprint"]),
                    code_fingerprint=str(payload["code_fingerprint"]),
                    development_record_fingerprint=str(
                        payload["development_record_fingerprint"]
                    ),
                    holdout_version=str(payload["holdout_version"]),
                    evaluation_protocol_version=str(
                        payload["evaluation_protocol_version"]
                    ),
                    event_timestamp=str(payload["event_timestamp"]),
                    result_digest=(
                        str(payload["result_digest"])
                        if payload.get("result_digest") is not None
                        else None
                    ),
                    label=(
                        str(payload["label"])
                        if payload.get("label") is not None
                        else None
                    ),
                )
            )
        return tuple(entries)

    def _records(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        loaded: list[dict[str, Any]] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise LedgerIntegrityError("research ledger record is invalid")
            loaded.append(value)
        return loaded

    def _last_hash(self) -> str:
        records = self._records()
        return str(records[-1]["entry_hash"]) if records else "GENESIS"

    def verify(self) -> None:
        previous = "GENESIS"
        for record in self._records():
            if record.get("previous_hash") != previous:
                raise LedgerIntegrityError("research ledger hash chain is broken")
            body = {
                "entry_type": record.get("entry_type"),
                "entry": record["entry"],
                "previous_hash": record["previous_hash"],
            }
            expected = _hash(body)
            if record.get("entry_hash") != expected:
                raise LedgerIntegrityError("research ledger entry was modified")
            previous = expected

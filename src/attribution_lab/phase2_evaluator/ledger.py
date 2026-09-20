from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


class LedgerIntegrityError(RuntimeError):
    pass


def _canonical(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def _hash(payload: Any) -> str:
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


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


class ResearchLedger:
    """Append-only hash-chained synthetic research history."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, entry: EvaluationLedgerEntry) -> str:
        previous_hash = self._last_hash()
        body = {
            "entry": asdict(entry),
            "previous_hash": previous_hash,
        }
        entry_hash = _hash(body)
        record = {**body, "entry_hash": entry_hash}
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(_canonical(record) + "\n")
        return entry_hash

    def _records(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        return [
            json.loads(line)
            for line in self.path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def _last_hash(self) -> str:
        records = self._records()
        return str(records[-1]["entry_hash"]) if records else "GENESIS"

    def verify(self) -> None:
        previous = "GENESIS"
        for record in self._records():
            if record.get("previous_hash") != previous:
                raise LedgerIntegrityError("research ledger hash chain is broken")
            body = {
                "entry": record["entry"],
                "previous_hash": record["previous_hash"],
            }
            expected = _hash(body)
            if record.get("entry_hash") != expected:
                raise LedgerIntegrityError("research ledger entry was modified")
            previous = expected

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from attribution_lab.phase2.development import DevelopmentWorldRecord
from phase2_candidate_sdk import CandidateDeclaration, fingerprint_payload


class CandidateVersionConflict(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class RegisteredCandidate:
    candidate_id: str
    version: str
    declaration_fingerprint: str
    code_fingerprint: str
    development_record_fingerprint: str
    lineage_fingerprint: str
    registered_at: str


def fingerprint_source(source: str) -> str:
    return fingerprint_payload({"source": source.replace("\r\n", "\n")})


def _substantive_declaration(declaration: CandidateDeclaration) -> dict[str, Any]:
    payload = asdict(declaration)
    payload.pop("candidate_id", None)
    payload.pop("version", None)
    return payload


def _substantive_development(
    development_record: DevelopmentWorldRecord,
) -> dict[str, Any]:
    payload = asdict(development_record)
    payload.pop("candidate_id", None)
    payload.pop("candidate_version", None)
    return payload


def fingerprint_candidate_lineage(
    declaration: CandidateDeclaration,
    source: str,
    development_record: DevelopmentWorldRecord,
) -> str:
    """Fingerprint substantive candidate identity, excluding ID/version aliases."""
    return fingerprint_payload(
        {
            "declaration": _substantive_declaration(declaration),
            "source_fingerprint": fingerprint_source(source),
            "development_record": _substantive_development(development_record),
        }
    )


class CandidateRegistry:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, candidate_id: str, version: str) -> Path:
        safe = f"{candidate_id}__{version}".replace("/", "_")
        return self.root / f"{safe}.registration.json"

    def register(
        self,
        declaration: CandidateDeclaration,
        source: str,
        development_record: DevelopmentWorldRecord,
        *,
        registered_at: str | None = None,
    ) -> RegisteredCandidate:
        code_fingerprint = fingerprint_source(source)
        lineage_fingerprint = fingerprint_candidate_lineage(
            declaration,
            source,
            development_record,
        )
        payload: dict[str, Any] = {
            "candidate_id": declaration.candidate_id,
            "version": declaration.version,
            "declaration": asdict(declaration),
            "declaration_fingerprint": declaration.fingerprint,
            "code_fingerprint": code_fingerprint,
            "development_record": asdict(development_record),
            "development_record_fingerprint": development_record.fingerprint,
            "lineage_fingerprint": lineage_fingerprint,
            "registered_at": registered_at or datetime.now(UTC).isoformat(),
        }
        path = self._path(declaration.candidate_id, declaration.version)
        if path.exists():
            existing = self.read(declaration.candidate_id, declaration.version)
            immutable_keys = (
                "declaration_fingerprint",
                "code_fingerprint",
                "development_record_fingerprint",
                "lineage_fingerprint",
            )
            if any(existing.get(key) != payload.get(key) for key in immutable_keys):
                raise CandidateVersionConflict(
                    "candidate ID/version is immutable; submit a new candidate version"
                )
            return self._registered(existing)

        path.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return self._registered(payload)

    def validate_frozen(
        self,
        declaration: CandidateDeclaration,
        source: str,
    ) -> RegisteredCandidate:
        path = self._path(declaration.candidate_id, declaration.version)
        if not path.exists():
            raise CandidateVersionConflict("candidate must be registered before evaluation")
        payload = self.read(declaration.candidate_id, declaration.version)
        if payload["declaration_fingerprint"] != declaration.fingerprint:
            raise CandidateVersionConflict("declaration changed after registration")
        if payload["code_fingerprint"] != fingerprint_source(source):
            raise CandidateVersionConflict("candidate code changed after registration")
        return self._registered(payload)

    @staticmethod
    def _registered(payload: dict[str, Any]) -> RegisteredCandidate:
        return RegisteredCandidate(
            candidate_id=str(payload["candidate_id"]),
            version=str(payload["version"]),
            declaration_fingerprint=str(payload["declaration_fingerprint"]),
            code_fingerprint=str(payload["code_fingerprint"]),
            development_record_fingerprint=str(
                payload["development_record_fingerprint"]
            ),
            lineage_fingerprint=str(payload["lineage_fingerprint"]),
            registered_at=str(payload["registered_at"]),
        )

    def read(self, candidate_id: str, version: str) -> dict[str, Any]:
        path = self._path(candidate_id, version)
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise CandidateVersionConflict("candidate registration payload is invalid")
        return cast(dict[str, Any], loaded)

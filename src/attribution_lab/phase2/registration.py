from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from attribution_lab.phase2.development import DevelopmentWorldRecord
from phase2_candidate_sdk import CandidateDeclaration, fingerprint_payload


class CandidateVersionConflict(RuntimeError):
    pass


class RepeatedHoldoutPeek(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class RegisteredCandidate:
    candidate_id: str
    version: str
    declaration_fingerprint: str
    code_fingerprint: str
    development_record_fingerprint: str
    registered_at: str


def fingerprint_source(source: str) -> str:
    return fingerprint_payload({"source": source.replace("\r\n", "\n")})


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
        payload = {
            "candidate_id": declaration.candidate_id,
            "version": declaration.version,
            "declaration": asdict(declaration),
            "declaration_fingerprint": declaration.fingerprint,
            "code_fingerprint": code_fingerprint,
            "development_record": asdict(development_record),
            "development_record_fingerprint": development_record.fingerprint,
            "registered_at": registered_at or datetime.now(UTC).isoformat(),
            "holdout_exposures": [],
        }
        path = self._path(declaration.candidate_id, declaration.version)
        if path.exists():
            existing = json.loads(path.read_text(encoding="utf-8"))
            immutable_keys = (
                "declaration_fingerprint",
                "code_fingerprint",
                "development_record_fingerprint",
            )
            if any(existing.get(key) != payload.get(key) for key in immutable_keys):
                raise CandidateVersionConflict(
                    "candidate ID/version is immutable; submit a new candidate version"
                )
            return RegisteredCandidate(
                candidate_id=existing["candidate_id"],
                version=existing["version"],
                declaration_fingerprint=existing["declaration_fingerprint"],
                code_fingerprint=existing["code_fingerprint"],
                development_record_fingerprint=existing["development_record_fingerprint"],
                registered_at=existing["registered_at"],
            )

        path.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return RegisteredCandidate(
            candidate_id=declaration.candidate_id,
            version=declaration.version,
            declaration_fingerprint=declaration.fingerprint,
            code_fingerprint=code_fingerprint,
            development_record_fingerprint=development_record.fingerprint,
            registered_at=payload["registered_at"],
        )

    def mark_holdout_exposure(
        self,
        declaration: CandidateDeclaration,
        source: str,
        holdout_version: str,
        *,
        reproducibility_rerun: bool = False,
        exposed_at: str | None = None,
    ) -> None:
        path = self._path(declaration.candidate_id, declaration.version)
        if not path.exists():
            raise CandidateVersionConflict("candidate must be registered before holdout use")
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload["declaration_fingerprint"] != declaration.fingerprint:
            raise CandidateVersionConflict("declaration changed after registration")
        if payload["code_fingerprint"] != fingerprint_source(source):
            raise CandidateVersionConflict("candidate code changed after registration")

        prior = [
            item
            for item in payload["holdout_exposures"]
            if item["holdout_version"] == holdout_version
        ]
        if prior and not reproducibility_rerun:
            raise RepeatedHoldoutPeek(
                "repeated holdout exposure is blocked unless explicitly marked as "
                "a reproducibility rerun"
            )
        payload["holdout_exposures"].append(
            {
                "holdout_version": holdout_version,
                "exposed_at": exposed_at or datetime.now(UTC).isoformat(),
                "reproducibility_rerun": reproducibility_rerun,
                "code_fingerprint": payload["code_fingerprint"],
                "declaration_fingerprint": payload["declaration_fingerprint"],
            }
        )
        path.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def read(self, candidate_id: str, version: str) -> dict[str, object]:
        path = self._path(candidate_id, version)
        return json.loads(path.read_text(encoding="utf-8"))

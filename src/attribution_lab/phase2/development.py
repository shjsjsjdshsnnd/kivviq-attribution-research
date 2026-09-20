from __future__ import annotations

from dataclasses import asdict, dataclass

from phase2_candidate_sdk import fingerprint_payload


@dataclass(frozen=True, slots=True)
class DevelopmentWorldRecord:
    candidate_id: str
    candidate_version: str
    world_ids: tuple[str, ...]
    parameter_ranges: tuple[tuple[str, str], ...]
    architecture_selection_notes: str
    hyperparameter_selection_notes: str
    label: str = "DEVELOPMENT"

    def __post_init__(self) -> None:
        if not self.world_ids:
            raise ValueError("development-world usage must be recorded")
        if not self.architecture_selection_notes.strip():
            raise ValueError("architecture-selection usage must be recorded")
        if not self.hyperparameter_selection_notes.strip():
            raise ValueError("hyperparameter-selection usage must be recorded")

    @property
    def fingerprint(self) -> str:
        return fingerprint_payload(asdict(self))

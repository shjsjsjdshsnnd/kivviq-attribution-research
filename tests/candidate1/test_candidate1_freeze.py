# ruff: noqa: I001

import json
import sys
import tempfile
from pathlib import Path

from attribution_lab.phase2.registration import CandidateRegistry


ROOT = Path("phase2/candidates/candidate1")
sys.path.insert(0, str(ROOT.resolve()))

from candidate_definition import build_declaration, build_development_record  # noqa: E402


def test_candidate1_frozen_fingerprints_match_manifest() -> None:
    manifest = json.loads((ROOT / "freeze_manifest.json").read_text(encoding="utf-8"))
    source = (ROOT / "model.py").read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="candidate1-freeze-test-") as directory:
        registered = CandidateRegistry(directory).register(
            build_declaration(),
            source,
            build_development_record(),
            registered_at="2026-09-20T17:45:00+00:00",
        )
    assert registered.code_fingerprint == manifest["code_fingerprint"]
    assert registered.declaration_fingerprint == manifest["declaration_fingerprint"]
    assert (
        registered.development_record_fingerprint
        == manifest["development_record_fingerprint"]
    )
    assert registered.lineage_fingerprint == manifest["lineage_fingerprint"]

from __future__ import annotations

import ast
from pathlib import Path

from attribution_lab.phase2_evaluator.isolation import validate_candidate_source
from phase2.candidate1.spec import DECLARATION

ROOT = Path(__file__).resolve().parents[2]
SOURCE_PATH = ROOT / "phase2" / "candidate1" / "candidate.py"


def test_candidate1_source_passes_holdout_import_boundary() -> None:
    source = SOURCE_PATH.read_text(encoding="utf-8")
    validate_candidate_source(source)


def test_candidate1_source_contains_no_oracle_or_harness_imports() -> None:
    source = SOURCE_PATH.read_text(encoding="utf-8")
    tree = ast.parse(source)
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.append(node.module)
    assert all(
        module == "phase2_candidate_sdk"
        or module == "__future__"
        or not module.startswith("attribution_lab")
        for module in imports
    )


def test_candidate1_estimand_is_incremental_conversion_probability() -> None:
    assert DECLARATION.estimand.kind.value == "incremental_conversion_probability"
    assert DECLARATION.negative_effects_representable
    assert not DECLARATION.interactions_representable
    assert DECLARATION.version == "1.0.0"

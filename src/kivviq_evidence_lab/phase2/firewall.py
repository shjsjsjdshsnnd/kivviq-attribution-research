from __future__ import annotations

import ast
from pathlib import Path

FORBIDDEN_PREFIXES = (
    "kivviq_evidence_lab.phase2_evaluator",
    "..phase2_evaluator",
    "...phase2_evaluator",
)
FORBIDDEN_DYNAMIC_TOKENS = ("phase2_evaluator", "importlib.import_module", "__import__(")


def scan_candidate_isolation(root: str | Path) -> list[str]:
    root_path = Path(root)
    candidate_root = root_path / "src" / "kivviq_evidence_lab" / "phase2" / "candidates"
    findings: list[str] = []
    if not candidate_root.exists():
        return [f"missing candidate root: {candidate_root}"]

    for path in sorted(candidate_root.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(text, filename=str(path))
        except SyntaxError as exc:
            findings.append(f"{path}: syntax error: {exc}")
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = tuple(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                module = ("." * node.level) + (node.module or "")
                names = (module,)
            else:
                continue
            for name in names:
                if any(name.startswith(prefix) for prefix in FORBIDDEN_PREFIXES):
                    findings.append(f"{path}: forbidden evaluator import {name}")
        for token in FORBIDDEN_DYNAMIC_TOKENS:
            if token in text:
                findings.append(f"{path}: forbidden dynamic evaluator access token {token}")
    return findings

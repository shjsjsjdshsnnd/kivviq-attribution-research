from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}
FORBIDDEN_NAMES = {".env", ".env.local", "id_rsa", "id_ed25519"}
FORBIDDEN_SUFFIXES = {".sqlite", ".sqlite3", ".db", ".pem", ".p12", ".pfx"}
FORBIDDEN_PATH_PARTS = {".phase2_seals", "holdout_seals", "private_holdouts"}
MAX_RAW_DATASET_BYTES = 5 * 1024 * 1024

PATTERNS = {
    "private key": re.compile("-----BEGIN " + "PRIVATE KEY-----"),
    "github token": re.compile("ghp" + r"_[A-Za-z0-9]{30,}"),
    "merchant access token": re.compile("shpat" + r"_[A-Za-z0-9]{20,}"),
    "aws access key": re.compile("AKIA" + r"[0-9A-Z]{16}"),
    "generic bearer token": re.compile(
        r"Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}"
    ),
    "known real merchant name": re.compile("Maison" + r"\s+" + "Olive", re.IGNORECASE),
}


def iter_files() -> list[Path]:
    return [
        path
        for path in ROOT.rglob("*")
        if path.is_file() and not any(part in SKIP_DIRS for part in path.parts)
    ]


def main() -> int:
    failures: list[str] = []
    for path in iter_files():
        relative = path.relative_to(ROOT)
        if any(part in FORBIDDEN_PATH_PARTS for part in relative.parts):
            failures.append(f"forbidden evaluator-private artifact path: {relative}")
            continue
        if path.name.endswith(".seal.json"):
            failures.append(f"holdout seal must never be committed: {relative}")
            continue
        if path.name in FORBIDDEN_NAMES or path.suffix.lower() in FORBIDDEN_SUFFIXES:
            failures.append(f"forbidden sensitive artifact: {relative}")
            continue
        if "synthetic_data" in relative.parts and path.stat().st_size > MAX_RAW_DATASET_BYTES:
            failures.append(f"unexpectedly large synthetic dataset: {relative}")
        if path.stat().st_size > 2 * 1024 * 1024:
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for label, pattern in PATTERNS.items():
            if pattern.search(content):
                failures.append(f"suspicious {label} pattern: {relative}")

    if failures:
        print("Repository safety check failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Repository safety check passed: no obvious sensitive artifacts detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

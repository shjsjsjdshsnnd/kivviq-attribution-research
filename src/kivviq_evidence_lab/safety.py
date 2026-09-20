from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SafetyFinding:
    path: str
    reason: str


FORBIDDEN_FILENAMES = {".env", ".env.local", ".env.production", "id_rsa", "id_ed25519"}
LARGE_DATA_EXTENSIONS = {".csv", ".parquet", ".sqlite", ".db", ".dump", ".sql"}
PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    "OpenAI-style secret": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "Shopify-style access token": re.compile(r"\bshpat_[A-Za-z0-9]{20,}\b"),
    "Slack-style token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "credential assignment": re.compile(r"(?i)\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*[\"'][^\"']{8,}[\"']"),
    "non-synthetic email": re.compile(r"\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
}
SKIP_PARTS = {".git", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"}


def scan_repository(root: str | Path) -> list[SafetyFinding]:
    root = Path(root)
    findings: list[SafetyFinding] = []
    for path in root.rglob("*"):
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if path.name in FORBIDDEN_FILENAMES or path.name.startswith(".env."):
            findings.append(SafetyFinding(rel, "forbidden environment/key filename"))
        if path.suffix.lower() in LARGE_DATA_EXTENSIONS and path.stat().st_size > 1_000_000:
            findings.append(SafetyFinding(rel, "large unexpected raw dataset/database artifact"))
        if path.stat().st_size > 2_000_000:
            findings.append(SafetyFinding(rel, "unexpectedly large file; manual review required"))
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for reason, pattern in PATTERNS.items():
            if pattern.search(text):
                findings.append(SafetyFinding(rel, reason))
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fail on obvious unsafe artifacts in this public synthetic repository.")
    parser.add_argument("root", nargs="?", default=".")
    args = parser.parse_args(argv)
    findings = scan_repository(args.root)
    if findings:
        for f in findings:
            print(f"{f.path}: {f.reason}")
        return 1
    print("repository safety scan: no obvious unsafe artifacts detected")
    print("human diff review is still required; this scan cannot guarantee absence of sensitive material")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

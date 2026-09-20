from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from kivviq_evidence_lab.safety import scan_repository


class SafetyTests(unittest.TestCase):
    def test_clean_synthetic_tree_passes(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "fixture.json").write_text('{"merchant":"synthetic-shop","value":123}', encoding="utf-8")
            self.assertEqual(scan_repository(root), [])

    def test_env_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / ".env").write_text("SAFE_PLACEHOLDER=synthetic", encoding="utf-8")
            findings = scan_repository(root)
            self.assertTrue(any("forbidden environment" in f.reason for f in findings))

    def test_private_key_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "bad.txt").write_text("-----BEGIN " + "PRIVATE KEY-----\nsynthetic\n", encoding="utf-8")
            findings = scan_repository(root)
            self.assertTrue(any(f.reason == "private key" for f in findings))

    def test_non_example_email_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "bad.txt").write_text("contact: person" + "@" + "merchant.test", encoding="utf-8")
            findings = scan_repository(root)
            self.assertTrue(any(f.reason == "non-synthetic email" for f in findings))

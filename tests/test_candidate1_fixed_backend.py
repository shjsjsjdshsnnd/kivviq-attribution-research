from __future__ import annotations

import unittest

from kivviq_evidence_lab.phase2.candidates.anthropic_opus5 import (
    FIXED_EFFORT,
    FIXED_MAX_TOKENS,
    FIXED_MODEL_ID,
    FIXED_THINKING_TYPE,
    _request_body,
    fixed_inference_settings,
)
from kivviq_evidence_lab.phase2.candidate1_cli import manifest
from kivviq_evidence_lab.phase2.candidates.candidate1 import CANDIDATE_VERSION, PROMPT_VERSION


class Candidate1FixedBackendTests(unittest.TestCase):
    def test_candidate_identity_is_exact(self) -> None:
        self.assertEqual(CANDIDATE_VERSION, "phase2-candidate1-model-semantic-v1.0.0")
        self.assertEqual(PROMPT_VERSION, "phase2-candidate1-prompt-v1.0.0")
        self.assertEqual(FIXED_MODEL_ID, "claude-opus-5")
        self.assertEqual(FIXED_EFFORT, "high")
        self.assertEqual(FIXED_THINKING_TYPE, "adaptive")
        self.assertEqual(FIXED_MAX_TOKENS, 4096)

    def test_request_body_has_no_sampling_overrides_or_tools(self) -> None:
        body = _request_body("system", "user")
        self.assertEqual(body["model"], "claude-opus-5")
        self.assertEqual(body["thinking"], {"type": "adaptive"})
        self.assertEqual(body["output_config"], {"effort": "high"})
        self.assertEqual(body["max_tokens"], 4096)
        self.assertNotIn("temperature", body)
        self.assertNotIn("top_p", body)
        self.assertNotIn("top_k", body)
        self.assertNotIn("tools", body)

    def test_manifest_is_not_generic(self) -> None:
        actual = manifest()
        self.assertEqual(actual["candidate_version"], CANDIDATE_VERSION)
        self.assertEqual(actual["prompt_version"], PROMPT_VERSION)
        self.assertEqual(actual["inference"], fixed_inference_settings())


if __name__ == "__main__":
    unittest.main()

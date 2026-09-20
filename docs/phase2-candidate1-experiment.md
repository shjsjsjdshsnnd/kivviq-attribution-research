# Candidate 1 fixed experiment configuration

Candidate 1 development is pinned to one model and one inference configuration.

- provider: Anthropic Messages API
- model: `claude-opus-5`
- candidate: `phase2-candidate1-model-semantic-v1.0.0`
- prompt: `phase2-candidate1-prompt-v1.0.0`
- max tokens: 4096
- thinking: adaptive
- effort: high
- temperature: omitted
- top-p: omitted
- top-k: omitted
- tools: none
- API version header: `2023-06-01`

The same backend is used for visible development evaluation and, after freezing, the one allowed sealed holdout-v1 evaluation.

## Development

The manual `Phase 2 Candidate 1 Development` workflow runs the 96 visible development cases only. It may be rerun while Candidate 1 is being improved from development evidence.

The API key is read only from the GitHub Actions secret `KIVVIQ_RESEARCH_ANTHROPIC_API_KEY`. The value is never committed or printed. The key must be research-only and must not be copied from production Kivviq.

## Holdout lock

The manual `Phase 2 Candidate 1 Sealed Holdout` workflow has no model/version inputs. It is deliberately non-runnable while:

`FROZEN_CANDIDATE_SHA = "UNFROZEN"`

After development is complete, Candidate 1 must be frozen at an exact commit and a frozen ref. A later workflow-only commit may replace `UNFROZEN` with that exact SHA. The workflow then checks out that exact commit, verifies the hard-coded candidate/prompt/model/settings manifest, and runs the sealed evaluator.

This prevents the holdout runner from becoming a generic arbitrary-candidate query interface.

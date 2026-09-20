# Frozen Phase 1 Evidence & Reasoning Baseline

Phase 1 is frozen independently from Phase 2 experiments.

- Frozen implementation commit: `0f08e73915c0984d13ed47ac10059d41abc46e45`
- Frozen ref: `frozen/phase1-evidence-reasoning-v1`
- Benchmark version: `phase1-evidence-reasoning-v1.0.0`
- Benchmark cases: 545
- Mutation-suite version: `phase1-mutations-v1.0.0`
- Unit tests: 35/35
- Benchmark: 545/545
- Mutation detection: 10/10
- False-refusal rate: 0.0
- False-claim rate: 0.0
- Category failures: none
- Reference clock: `2026-09-20T12:00:00-04:00` (`America/Toronto`)
- Reproduction CI: GitHub Actions `ubuntu-latest`, Python 3.11.16
- CI gates on the frozen commit: repository safety, Ruff, strict mypy, unit tests, Phase 1 benchmark, mutation suite
- Runtime dependencies: none outside the Python standard library
- Development CI tools: Ruff and mypy as constrained in `pyproject.toml`

The GitHub Actions run for the frozen implementation commit completed every required stage successfully. No skipped stage is treated as passing.

## Freeze rule

The frozen Phase 1 benchmark must not be edited to rescue a Phase 2 candidate. A changed benchmark, truth definition, mutation, or scoring contract must receive a new explicit version. The frozen ref is not a development branch.

## Known limitations

Phase 1 uses a deterministic rule-based resolver and a controlled synthetic distribution. It does not establish open-ended natural-language generalization, live identity-resolution quality, causal incrementality, complete accounting coverage, or production performance. Perfect Phase 1 benchmark scores must not be presented as evidence that production Kivviq is correct.

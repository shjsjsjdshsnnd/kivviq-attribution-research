# Kivviq Attribution Research

A public, synthetic-data-only research laboratory for studying marketing attribution methods under controlled data-generating processes.

## Non-negotiable boundary

This repository accepts **synthetic data only**. It must remain completely independent from private application code and real merchant systems.

Do not access, copy, infer, import, or reference private repositories, real merchant data, production databases or schemas, credentials or tokens, customer information, private endpoints, proprietary application code, or production environment variables. Do not connect this repository to external merchant platforms or APIs.

## Research distinction

**Descriptive attribution** allocates observed conversion credit.

**Causal/incremental effect** describes conversions caused by marketing.

Those are not interchangeable. The benchmark label **SYNTHETIC CAUSAL RECOVERY** means distance from simulator-defined truth only; it is not a real-world causal-accuracy claim.

## Phase 1

The frozen baseline set is:

1. first touch
2. last touch
3. last paid touch
4. linear
5. time decay
6. position based
7. Markov removal
8. Shapley-based attribution

Phase 1 contains the canonical journey schema, synthetic causal-world generator, immutable ground-truth manifests, measurement corruption, leakage-safe horizon labeling, repeated experiment runner, uncertainty analysis, support diagnostics, failure-mode catalog, simulator-bias audit, and generated research reporting.

No Phase 2 model is implemented here.

## Install and verify

Use Python 3.11+:

```bash
python -m pip install -e ".[dev]"
python scripts/check_repo_safety.py
ruff check .
mypy
pytest
```

## Fast CI benchmark

```bash
python examples/run_benchmark.py --quick --output benchmark_output
```

## Full Phase 1 research benchmark

```bash
python examples/run_benchmark.py --output research_output
```

The full matrix uses 20 scenario variants, 5 deterministic seeds, 3 sample sizes, 15 observation-quality conditions, and all 8 baselines: **4,500 synthetic experiments and 36,000 model evaluations**.

The separate `Full research benchmark` GitHub Actions workflow runs the full matrix and uploads the generated analysis artifacts. Normal PR CI remains fast.

## Ground-truth manifest

Every causal world records the complete declared data-generating process: baseline conversion probability, structural channel effects, interactions, exposure/selection mechanisms, temporal effects, latent variables, outcome equation, random seed, simulator parameters, and derived synthetic incremental effects.

Evaluation reads the manifest directly. It never reconstructs truth from corrupted observations.

## Output interpretation

Generated research reports separate **MATHEMATICAL CONSEQUENCE** from **EMPIRICAL SIMULATION RESULT**. They do not declare an overall winner, provide model scores, recommend a production model, or claim external causal validity.

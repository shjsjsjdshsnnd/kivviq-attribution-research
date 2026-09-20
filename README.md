# Kivviq Attribution Research

A public, synthetic-data-only research laboratory for studying marketing attribution methods under controlled data-generating processes.

## Non-negotiable boundary

This repository accepts **synthetic data only**. It must remain completely independent from private application code and real merchant systems.

Do not access, copy, infer, import, or reference private repositories, real merchant data, production databases or schemas, credentials or tokens, customer information, private endpoints, proprietary application code, or production environment variables. Do not connect this repository to external merchant platforms or APIs.

The research question is deliberately narrower:

> Under controlled synthetic worlds where the true data-generating process is known, how do different marketing-attribution methods behave, where do they fail, and which methods warrant later evaluation against governed real-world data?

## Research distinction

**Descriptive attribution** allocates observed conversion credit.

**Causal/incremental effect** describes conversions caused by marketing.

Those are not interchangeable. A descriptive attribution result must never be called incremental merely because it resembles synthetic causal truth in a benchmark.

## Phase 1 scope

Phase 1 provides:

- a canonical journey schema with purchasers and non-purchasers;
- explicit observation windows, consent state, identity confidence, acquisition evidence, and ordered events;
- eight baseline models behind one interface: first touch, last touch, last paid touch, linear, time decay, position based, Markov removal, and Shapley-based attribution;
- configurable synthetic ecommerce worlds with latent intent and known structural effects;
- a machine-readable ground-truth manifest for every causal world;
- measurement corruption for missing events, UTMs, click IDs, identity fragmentation, cookie loss, delayed or duplicated events, consent exclusion, censoring, and related failures;
- leakage-safe horizon labeling;
- evaluation metrics for conservation, rank agreement, bias, normalized error, null-channel behavior, and synthetic causal recovery;
- a configuration-driven experiment runner and benchmark suite;
- deterministic tests, linting, type checking, CI, and repository safety checks.

Phase 1 does **not** declare an overall model winner and does not implement future experimental model families.

## Ground-truth manifest

Every generated causal world owns a manifest recording the complete data-generating process: baseline conversion probability, structural channel treatment effects, interaction effects, exposure/selection mechanisms, temporal effects, latent variables, outcome-generation equation, random seed, all simulator parameters, and derived channel incremental effects.

Evaluation consumes this manifest directly. It never reconstructs or infers synthetic causal truth from observations. Measurement corruption returns the same manifest object, and regression tests prove observed/corrupted data cannot modify stored latent truth.

Benchmark output persists deduplicated manifests in `ground_truth_manifests.json` so synthetic truth remains independently inspectable after a run.

## Install and verify

Use Python 3.11+:

```bash
python -m pip install -e ".[dev]"
python scripts/check_repo_safety.py
ruff check .
mypy
pytest
```

## Benchmark

Run a deterministic quick benchmark:

```bash
python examples/run_benchmark.py --quick --output benchmark_output
```

The benchmark includes single-touch, balanced multi-touch, strong first- and final-touch worlds, brand-search demand capture, retargeting selection bias, a null paid channel, channel interaction, fragmented identity, and 10%, 25%, and 50% missing-touch cases. All eight baseline models run.

Generated results should not be committed as large datasets. Compact machine-readable summaries are supported for reproducibility.

## Package layout

- `src/attribution_lab/schemas`: canonical observed journey structures
- `src/attribution_lab/models`: eight baseline attribution methods
- `src/attribution_lab/simulation`: causal synthetic worlds and ground truth
- `src/attribution_lab/stress`: controlled measurement corruption
- `src/attribution_lab/evaluation`: horizon labels and evaluation metrics
- `src/attribution_lab/runner.py`: experiment and benchmark orchestration
- `tests`: invariants, leakage, corruption, manifest, and runner tests
- `scripts/check_repo_safety.py`: public-repository guardrail
- `docs/phase1.md`: research design and limitations

## Interpretation

A good result here means only that a method behaved a certain way under a declared synthetic world. It is not evidence that the same method is accurate on real merchant data, and it is not proof of real-world incrementality.

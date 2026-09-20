# Phase 1 research design

## Objective

Build a falsifiable synthetic laboratory for marketing attribution. Phase 1 compares behavioral fingerprints and failure modes; it does not crown a model and it does not validate real-world incrementality.

## Baseline freeze

The model registry is frozen to exactly eight baselines: first touch, last touch, last paid touch, linear, time decay, position based, Markov removal, and Shapley-based attribution. Phase 1 validation may fix verified defects but does not tune or add models.

## Ground-truth manifest

Every causal world persists baseline conversion probability, channel treatment effects, interactions, exposure/selection mechanisms, temporal effects, latent-intent parameters, the outcome equation, seed, simulator parameters, and derived synthetic incremental effects.

Evaluation consumes this manifest directly. Corruption reuses the exact manifest object. Regression tests verify that altered observations cannot mutate or redefine latent truth.

## Full repeated validation matrix

The manual research benchmark spans:

- 20 declared scenario variants covering all Phase 1 families plus journey-length, channel-prevalence, and null-channel stress variants;
- 5 deterministic seeds;
- sample sizes 80, 250, and 800;
- 15 observation-quality conditions;
- all 8 frozen baseline models.

That is 4,500 synthetic experiment cells and 36,000 model evaluations.

The matrix includes perfect observation; 10%, 25%, and 50% random touch loss; channel-specific missingness; identity fragmentation; missing click IDs; UTM corruption/removal; cookie loss; session splitting; delayed and duplicated events; consent exclusions; and observation censoring.

The fast PR benchmark remains intentionally smaller. The full matrix runs in the separate public GitHub Actions research workflow and emits a compressed machine-readable result set plus summary analysis artifacts.

## Measurement failure semantics

Identity fragmentation and cookie loss split observed journey identity rather than merely lowering a confidence number. Observation censoring truncates the visible observation window and later evidence. Session splitting deliberately preserves touch order so models that ignore session boundaries can demonstrate that invariance empirically.

The intended pipeline remains:

`latent synthetic truth -> pristine observed synthetic data -> corrupted observed synthetic data`

## Leakage rule

For horizon `H`, a purchase counts only inside `[subject_start, subject_start + H)`. Completed horizons without purchase are negative; incomplete horizons are censored. Touches at or after an attributed outcome cannot receive credit. Later identity information does not rewrite earlier features.

## Evaluation

Per-experiment metrics include credit conservation, rank agreement, absolute and normalized attribution error, channel-level bias, false credit to null channels, and explicitly labeled SYNTHETIC CAUSAL RECOVERY.

Cross-replication analysis adds mean, median, standard deviation, p10/p90 intervals, seed replication counts, model divergence from its own perfect-observation output, sample-size behavior, and measurement-degradation curves.

Markov reports transition/path support. Shapley reports observed path-set and coalition support.

## Failure-mode catalog

The benchmark generator emits machine-readable and human-readable failure catalogs with model, scenario, conditions, observed behavior, stored ground truth, magnitude, repeatability, explanation, mathematical-versus-empirical classification, measurement quality, and sample-size dependence.

## Simulator-bias audit

Validation checks that:

- the simulation package does not import attribution models;
- corruption does not branch on model identity;
- all models in an experiment receive the same corrupted data summary and stored truth;
- manifest digests remain stable across corruption conditions;
- positional assumptions are declared in manifests rather than hidden.

Unavoidable synthetic assumptions are documented in the generated report.

## Outputs

A full run writes:

- `results.jsonl.gz`
- `ground_truth_manifests.json`
- `matrix.json`
- `uncertainty.json`
- `failure_modes.json`
- `failure_modes.md`
- `simulator_bias_audit.json`
- `phase1_research_report.md`

No generated large result dataset is committed to Git.

## Interpretation

SYNTHETIC CAUSAL RECOVERY is distance from simulator-defined intervention truth. It is not real-world causal accuracy. No overall winner, model score, arbitrary ranking, or production recommendation is produced.

Future model families remain deferred until the Phase 1 validation gate is satisfied.

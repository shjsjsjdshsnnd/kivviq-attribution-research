# Phase 1 attribution validation report

## Scope

This report describes repeated **synthetic** experiments only. Descriptive attribution and synthetic incremental truth are separate quantities. SYNTHETIC CAUSAL RECOVERY is not real-world causal accuracy.

No overall model winner, production recommendation, or real-world causal claim is made.

## Benchmark matrix

- Scenarios: 20
- Seeds: [7, 17, 29, 41, 73]
- Sample sizes: [80, 250, 800]
- Observation qualities: 15
- Baseline models: 8
- Synthetic experiments: 4500
- Model evaluations: 36000

## Model behavioral fingerprints

| Model | Mathematical consequence | Null credit | Demand-capture credit | Retargeting-selected credit | 50% touch-loss divergence | Identity-fragmentation divergence |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| first_touch | Allocates all observed conversion credit to the earliest eligible touch. | 0.232 | 0.119 | 0.103 | 0.375 | 0.223 |
| last_touch | Allocates all observed conversion credit to the latest eligible touch. | 0.501 | 0.534 | 0.806 | 0.420 | 0.000 |
| last_paid_touch | Allocates credit to the latest paid touch, falling back to latest touch. | 0.585 | 0.534 | 0.806 | 0.461 | 0.100 |
| linear | Splits each observed conversion equally across its eligible touches. | 0.333 | 0.276 | 0.387 | 0.267 | 0.111 |
| time_decay | Weights observed touches by recency using the declared half-life. | 0.402 | 0.378 | 0.540 | 0.298 | 0.066 |
| position_based | Uses declared first/last weights and shares remaining credit across middle touches. | 0.351 | 0.303 | 0.421 | 0.278 | 0.108 |
| markov_removal | Uses empirical transition paths and channel-removal effects over completed journeys. | 0.192 | 0.345 | 0.232 | 1.108 | 0.895 |
| shapley | Uses an empirical coalition conversion-rate game over observed channel sets. | 0.346 | 0.521 | 0.695 | 0.799 | 0.436 |

The allocation descriptions above are **MATHEMATICAL CONSEQUENCES** of the defined rules. The numeric columns are **EMPIRICAL SIMULATION RESULTS**.

## Null-channel test

Pinterest is the deliberately null paid channel in these variants. Its stored synthetic incremental effect is zero; prevalence, path position, and selection are varied independently.

| Model | Base null | High prevalence | Late position | High-intent selection | Retargeting-like |
| --- | ---: | ---: | ---: | ---: | ---: |
| first_touch | 0.253 | 0.330 | 0.094 | 0.372 | 0.111 |
| last_touch | 0.260 | 0.471 | 0.589 | 0.399 | 0.789 |
| last_paid_touch | 0.397 | 0.614 | 0.589 | 0.536 | 0.789 |
| linear | 0.273 | 0.389 | 0.273 | 0.369 | 0.364 |
| time_decay | 0.276 | 0.424 | 0.397 | 0.383 | 0.529 |
| position_based | 0.264 | 0.396 | 0.308 | 0.376 | 0.409 |
| markov_removal | 0.000 | 0.000 | 0.270 | 0.000 | 0.687 |
| shapley | 0.153 | 0.244 | 0.153 | 0.582 | 0.596 |

## Demand capture

The demand-capture world intentionally puts Google Brand near purchase while its structural effect is zero. The table reports descriptive credit, not effect.

| Model | Mean Google Brand credit | Mean stored synthetic effect |
| --- | ---: | ---: |
| first_touch | 0.119 | 0.000 |
| last_touch | 0.534 | 0.000 |
| last_paid_touch | 0.534 | 0.000 |
| linear | 0.276 | 0.000 |
| time_decay | 0.378 | 0.000 |
| position_based | 0.303 | 0.000 |
| markov_removal | 0.345 | 0.000 |
| shapley | 0.521 | 0.000 |

## Retargeting selection

The retargeting-selection world exposes high-intent subjects to Meta more often while the Meta structural effect is zero.

| Model | Mean Meta credit | Mean stored synthetic effect |
| --- | ---: | ---: |
| first_touch | 0.103 | 0.000 |
| last_touch | 0.806 | 0.000 |
| last_paid_touch | 0.806 | 0.000 |
| linear | 0.387 | 0.000 |
| time_decay | 0.540 | 0.000 |
| position_based | 0.421 | 0.000 |
| markov_removal | 0.232 | 0.000 |
| shapley | 0.695 | 0.000 |

## Interaction world

The outcome equation explicitly contains a Meta × Email interaction. Coalition logic alone does not make an observed-data Shapley calculation causal.

| Model | Mean SYNTHETIC CAUSAL RECOVERY L1 | Meta + Email descriptive credit |
| --- | ---: | ---: |
| first_touch | 1.268 | 0.366 |
| last_touch | 1.401 | 0.299 |
| last_paid_touch | 1.320 | 0.340 |
| linear | 1.349 | 0.326 |
| time_decay | 1.377 | 0.311 |
| position_based | 1.340 | 0.330 |
| markov_removal | 1.370 | 0.015 |
| shapley | 1.093 | 0.466 |

## Measurement-degradation curves

Divergence is the L1 distance between a model's corrupted-observation credit vector and that same model's perfect-observation vector for the identical scenario, seed, and sample size.

| Model | 10% missing | 25% missing | 50% missing | Channel-specific missing |
| --- | ---: | ---: | ---: | ---: |
| first_touch | 0.116 | 0.230 | 0.375 | 0.211 |
| last_touch | 0.123 | 0.259 | 0.420 | 0.169 |
| last_paid_touch | 0.124 | 0.259 | 0.461 | 0.266 |
| linear | 0.081 | 0.153 | 0.267 | 0.183 |
| time_decay | 0.089 | 0.180 | 0.298 | 0.173 |
| position_based | 0.087 | 0.163 | 0.278 | 0.187 |
| markov_removal | 1.056 | 1.036 | 1.108 | 0.889 |
| shapley | 0.389 | 0.599 | 0.799 | 0.439 |

## Journey-length and channel-prevalence sensitivity

| Model | Short-journey recovery L1 | Long-journey recovery L1 | Rare-channel recovery L1 | Common-channel recovery L1 |
| --- | ---: | ---: | ---: | ---: |
| first_touch | 0.606 | 0.567 | 0.650 | 0.682 |
| last_touch | 0.665 | 0.450 | 0.702 | 0.682 |
| last_paid_touch | 0.529 | 0.577 | 0.533 | 0.649 |
| linear | 0.605 | 0.449 | 0.650 | 0.587 |
| time_decay | 0.629 | 0.416 | 0.676 | 0.595 |
| position_based | 0.605 | 0.453 | 0.651 | 0.597 |
| markov_removal | 1.396 | 1.129 | 1.185 | 1.465 |
| shapley | 1.047 | 1.121 | 1.128 | 1.192 |

## Sparse-support diagnostics

Markov reports empirical transition support. Shapley reports observed channel-set support relative to its possible coalition universe.

| Sample size | Markov rare-transition fraction | Markov unique paths | Shapley observed-set support ratio | Shapley unique path sets |
| ---: | ---: | ---: | ---: | ---: |
| 80 | 0.573 | 43.800 | 0.144 | 36.800 |
| 250 | 0.289 | 100.400 | 0.280 | 71.800 |
| 800 | 0.044 | 209.600 | 0.457 | 117.000 |

## Uncertainty across deterministic seeds

Each full-matrix cell uses repeated deterministic seeds. Values below summarize the across-seed standard deviation of SYNTHETIC CAUSAL RECOVERY L1 across cells; they are uncertainty diagnostics, not significance tests.

| Model | Mean cell stddev at smallest sample | Mean cell stddev at largest sample |
| --- | ---: | ---: |
| first_touch | 0.331 | 0.107 |
| last_touch | 0.262 | 0.106 |
| last_paid_touch | 0.304 | 0.108 |
| linear | 0.260 | 0.082 |
| time_decay | 0.248 | 0.085 |
| position_based | 0.257 | 0.084 |
| markov_removal | 0.372 | 0.366 |
| shapley | 0.359 | 0.260 |

## Simulator-bias audit

- **frozen_baseline_registry** — pass: observed model set: ['first_touch', 'last_paid_touch', 'last_touch', 'linear', 'markov_removal', 'position_based', 'shapley', 'time_decay']
- **manifest_invariant_across_corruption** — pass: every scenario/seed/sample-size group retained one manifest digest across all observation qualities
- **truth_consistent_across_models** — pass: all models in an experiment received identical stored synthetic truth
- **corruption_dataset_model_agnostic** — pass: all models in an experiment evaluated the same corrupted dataset summary
- **outcome_generation_separate_from_attribution** — pass: simulator tests enforce that the simulation package does not import the attribution model package
- **ordering_assumptions** — documented_assumption: default ordering is synthetic/random; scenarios with first/last effects declare temporal_position or temporal_log_odds_effect in the manifest

Documented simulator assumptions:
- outcomes use a logistic synthetic response model
- exposure depends on declared channel prevalence and optional latent-intent selection
- the channel universe is fixed to the Phase 1 synthetic schema
- counterfactual channel effects are simulator-defined and do not imply external validity
- corruption mechanisms are simplified controlled failures rather than browser-specific emulation

## Failure-mode catalog

Machine-readable and human-readable catalogs contain 77 data-supported failure entries. Entries distinguish mathematical consequences from empirical simulation results and include measurement quality, repeatability, magnitude, and sample-size dependence.

- empirical simulation result: 69
- mathematical consequence: 8

## Important interpretation limits

- SYNTHETIC CAUSAL RECOVERY compares model credit to simulator-defined intervention truth only.
- It does not establish external validity or real-world incrementality.
- The harmful-channel benchmark demonstrates that normalized non-negative credit cannot represent negative causal contribution.
- Missing click IDs and UTM corruption may have little direct effect on these baselines because the current baseline rules operate primarily on already-resolved channel paths; that is a property of this Phase 1 schema, not evidence that those identifiers are unimportant in production measurement.
- Session splitting can have limited effect on models that flatten ordered touchpoints across sessions.
- Support diagnostics should be interpreted empirically; no universal minimum sample size is inferred.

## Phase 2 research questions

Phase 2 should investigate questions rather than assume a preferred model:

1. Can explicitly causal estimands be recovered under richer time-varying treatment and selection mechanisms?
2. How should uncertainty in channel effects and path support be propagated into attribution outputs?
3. Which estimators remain stable under hidden intent, measurement loss, and identity fragmentation?
4. Can experimental or quasi-experimental evidence calibrate observational sequence models without conflating association and incrementality?
5. How should negative, heterogeneous, and interacting treatment effects be represented without forcing normalized non-negative credit?
6. What additional falsification tests should any future model pass before governed real-world evaluation?

No Phase 2 model is implemented by this report.

# Phase 1 research design

## Objective

Build a falsifiable synthetic laboratory for marketing attribution. Phase 1 compares behavioral fingerprints and failure modes; it does not crown a model and it does not validate real-world incrementality.

## Canonical observed schema

A synthetic subject can contain multiple ordered sessions and touchpoints, an optional conversion with value, an observation window, consent state, identity confidence, and acquisition evidence. Model-specific assumptions do not live in the schema.

## Baselines

The common interface includes first touch, last touch, last paid touch, linear, time decay, position based, first-order Markov removal, and an exact Shapley-based empirical conversion game. Parameters such as time-decay half-life, position weights and Shapley prior strength are explicit.

## Causal synthetic worlds

Configured worlds include pure acquisition, demand capture, retargeting selection bias, assisted conversion, channel interaction, organic/direct return, null-channel, harmful-channel, strong first-touch, and strong final-touch effects.

### Ground-truth manifest

Every causal world persists a machine-readable manifest containing:

- baseline conversion probability;
- channel treatment effects;
- channel interactions;
- exposure and selection mechanisms;
- temporal effects;
- latent-intent variables;
- the outcome-generation equation;
- random seed;
- all simulator parameters;
- derived average channel incremental effects from the latent synthetic world.

Evaluation consumes the manifest directly. It must not reconstruct or infer truth from observed journeys.

The corruption layer receives a `SyntheticWorld` and returns a new observed dataset while retaining the exact original manifest object. Tests verify the manifest digest and object identity do not change after observation corruption. Experiment output separately persists deduplicated manifests.

## Measurement failures

The corruption layer controls random and channel-specific missing touches, missing/corrupted UTMs, missing click IDs, identity fragmentation, cross-device fragmentation, cookie loss, session splitting, delayed events, duplication, missing purchases, missing non-purchasers, consent exclusion, and horizon censoring.

The intended pipeline is:

`perfect latent synthetic world -> observed synthetic dataset -> corrupted observed dataset`

## Leakage rule

For horizon `H`:

`Y_H(s)=1`

only when a purchase occurs in:

`[subject_start, subject_start + H)`

A completed horizon with no qualifying purchase is negative. An incomplete horizon is censored. A purchase after the horizon cannot change the earlier negative label. Touchpoints at or after a conversion cannot receive credit for that conversion. Later identity evidence does not rewrite earlier features.

## Evaluation

Phase 1 reports credit conservation, rank agreement, absolute and normalized error relative to normalized positive synthetic effect, channel-level bias, false credit to null channels, and an explicitly named synthetic-causal-recovery distance.

These diagnostics answer questions about declared synthetic worlds only. They do not establish real-world causal accuracy.

## Initial benchmark suite

The benchmark runs all eight baselines across:

- simple single-touch;
- balanced multi-touch;
- strong first-touch effect;
- strong final-touch effect;
- brand-search capture bias;
- retargeting selection bias;
- null paid channel;
- interaction-effect world;
- fragmented identity;
- 10%, 25%, and 50% missing-touch conditions.

Full runs repeat the suite across multiple random seeds.

## Phase 1 limitations

The simulator is deliberately inspectable rather than realistic in every ecommerce detail. Markov and Shapley are baseline implementations, not claims that a particular production formulation is canonical. The causal effects in the manifest are known because the simulator defines them; external validity is intentionally out of scope.

Future research may add survival/hazard, probabilistic sequence, Bayesian, uplift, heterogeneous-treatment-effect, doubly robust, causal-forest, representation-learning, or sequence-neural approaches. Those are explicitly deferred until the benchmark laboratory is stable.

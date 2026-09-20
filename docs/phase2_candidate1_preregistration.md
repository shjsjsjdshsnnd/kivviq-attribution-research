# Candidate 1 preregistration — Phase 2

**Candidate ID:** `phase2-candidate1-ipw`  
**Version:** `1.0.0`

This document and its machine-readable companion are committed **before estimator implementation**. Candidate 1 is intended to test the Phase 2 research process with an interpretable treatment-effect estimator; it is not another heuristic path-credit rule.

## 1. Estimand

Candidate 1 targets a **population-average controlled incremental conversion-probability effect, per channel**.

For each channel separately:

- population: synthetic subjects with complete 21-day observable horizons;
- unit: synthetic subject;
- treatment: at least one target-channel exposure during the horizon;
- outcome: qualifying conversion during the 21-day horizon;
- intervention: force target-channel exposure present;
- comparison: force target-channel exposure absent;
- other-channel assignment: held fixed;
- aggregation: population-average probability difference.

This is a signed treatment-effect estimand. It is not descriptive allocation.

## 2. Hypothesis

The falsifiable hypothesis is that a propensity-adjusted IPW estimator using only observable co-exposure and journey-history proxies can reduce selection-bias error relative to the failure pattern seen in descriptive Phase 1 attribution, **when those observables provide usable proxies for selection**.

The hypothesis is not that IPW will necessarily survive. Hidden latent intent, positivity failure, interactions, temporal effects, heterogeneity and measurement loss are explicit expected failure modes.

## 3. Method selected after estimand

The single Candidate 1 method is:

**per-channel logistic propensity model → stabilized inverse-probability weights → weighted treated-minus-untreated conversion mean**.

Reasons:

1. it directly targets treatment/exposure assignment rather than conversion-path credit;
2. every component is inspectable;
3. it can return negative effects;
4. it does not require a second outcome model;
5. failure under residual hidden confounding is interpretable.

No competing candidate family will be implemented in Candidate 1.

## 4. Observable adjustment set

Candidate code may use only:

- non-target channel assignment indicators;
- distinct non-target channel count;
- non-target touch count;
- session count;
- normalized earliest/latest non-target touch timing;
- identity confidence;
- the observable treatment indicator and conversion outcome.

The candidate does **not** receive latent purchase intent, true effects, counterfactual outcomes, hidden selection/interactions, holdout configuration or oracle truth.

The main causal assumption is that these observable co-exposure/history variables are adequate proxies for selection into the target exposure for the controlled estimand. That assumption is deliberately falsifiable and is expected to fail in some worlds.

## 5. Development-only hyperparameter selection

Development may compare only:

- L2: 0.01 / 0.1 / 0.5
- propensity clip: 0.03 / 0.05 / 0.10
- gradient steps: 300
- learning rate: 0.05

Selection criterion: lowest mean development synthetic-effect MAE; ties prefer stronger regularization and wider propensity clipping.

No frozen Phase 1 or holdout result may influence hyperparameter selection.

## 6. Uncertainty

The preregistered method is a deterministic subject bootstrap with a 90% interval.

- development: 100 replications;
- frozen candidate/evaluation: 200 replications.

Bootstrap randomness must be derived deterministically from the channel identifier and fixed candidate version, not from hidden evaluator truth.

## 7. Falsification

The machine-readable preregistration contains family-specific holdout thresholds fixed before implementation.

Key known-case requirements include:

- selected zero-effect channel in `retargeting_selection`: absolute effect <= 0.05;
- zero-effect demand-capture channel in `demand_capture`: absolute effect <= 0.05;
- null paid channel: absolute effect <= 0.05;
- harmful channel: correct negative sign and absolute error <= 0.08;
- 50% touch loss and identity fragmentation: effect-vector L1 divergence from perfect observation <= 0.20;
- no NaN/infinite outputs or invalid intervals.

A required holdout-family failure is not rescued by development or Phase 1 performance.

## 8. Public holdout limitation

The holdout-family architecture is public because this is a public research repository. Instantiated holdout seeds, parameter values, treatment effects, latent-intent strengths, interactions, selection mechanisms, and corruption settings remain sealed from candidate development. This provides strong research-process separation but is not equivalent to a completely secret external benchmark.

## 9. Freeze rule

This preregistration precedes estimator code. During DEVELOPMENT the implementation and listed hyperparameters may be selected using only declared development worlds.

Once Candidate 1 is frozen, its declaration, estimator source, selected hyperparameters, assumptions, estimand, hypothesis, uncertainty method and criteria are immutable. It then proceeds:

`DEVELOPMENT → FROZEN_PHASE1 → one SEALED_HOLDOUT exposure → ROBUSTNESS/UNCERTAINTY → SURVIVE/REJECT/INCONCLUSIVE`.

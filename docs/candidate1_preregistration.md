# Candidate 1 preregistration — before estimator implementation

**Candidate ID:** `candidate1-stratified-lpm`  
**Version:** `1.0.0`  
**Parent harness:** `3616d00c0855a0d3d9dcb8dbf578a3e68c26f9fa`

This artifact freezes the Candidate 1 **estimand and hypothesis before estimator implementation code exists**.

## Estimand

Candidate 1 targets a per-channel **population-average incremental conversion-probability risk difference** over a 21-day synthetic observation window.

For each channel independently:

- **Population:** synthetic subjects entering a 21-day observation window.
- **Unit:** synthetic subject.
- **Treatment:** at least one observed target-channel exposure before a qualifying conversion or horizon end.
- **Outcome:** qualifying conversion within 21 days.
- **Intervention:** set target exposure to present.
- **Comparison:** set target exposure to absent.
- **Temporal ordering:** eligible exposure precedes the qualifying conversion.
- **Regime:** binary single-channel intervention, evaluated separately by channel.
- **Aggregation:** population-average risk difference.

This is an incremental/treatment-effect estimand. It is **not** normalized descriptive attribution.

## Falsifiable hypothesis

An interpretable covariate-adjusted linear-probability treatment-effect estimator may reduce synthetic causal-recovery error under selection bias when observed cross-channel exposure patterns contain useful proxies for selection.

The mechanism is explicit: latent intent can make several channels co-occur. Adjustment for **other observed channel indicators plus measurement-state covariates** may absorb part of that selection association. The hypothesis is not that this eliminates hidden confounding.

It should fail when hidden intent is poorly proxied, overlap collapses, interactions/heterogeneity dominate, measurement loss corrupts the adjustment set, or static binary exposure is inadequate for time-varying effects.

## Selected method family

After defining the estimand, Candidate 1 selects one method family only:

**Ridge-stabilized linear probability outcome regression with HC1 robust intervals.**

The target-channel coefficient is interpreted as an adjusted conversion-risk difference under the stated assumptions. This method was selected for interpretability and direct estimand alignment, not from holdout performance.

No propensity estimator, doubly robust estimator, survival model, Bayesian model, causal forest, neural network or additional candidate family is implemented in Candidate 1.

## Observable adjustment set

Candidate-visible inputs are restricted to:

- channel-presence indicators;
- binary conversion outcome;
- identity confidence;
- censoring status;
- observation-window duration.

For a target channel, the nuisance adjustment set uses **other-channel presence indicators** plus the measurement-state covariates above.

## Deliberately unavailable information

Candidate 1 may never receive true latent intent, true treatment effects, oracle counterfactuals, selection coefficients, hidden interactions/heterogeneity, holdout seeds, hidden parameters or holdout corruption settings.

## Representability

- Negative effects: **yes**
- Heterogeneous effects: **not explicitly**
- Interactions: **not explicitly**

## Uncertainty target

95% heteroskedasticity-robust HC1 intervals around each channel risk-difference estimate.

## Falsification protocol

Exact numeric/family thresholds are **not selected in this preregistration commit**. They will be justified from development-only behavior and frozen before Candidate 1 is registered/frozen and before any sealed holdout exposure.

After freeze:

`FROZEN_PHASE1 -> one SEALED_HOLDOUT exposure -> robustness/uncertainty -> SURVIVE / REJECT / INCONCLUSIVE`

No post-holdout tuning is allowed.

## Public holdout limitation

The holdout-family architecture is public because this is a public research repository. Instantiated holdout seeds, parameter values, treatment effects, latent-intent strengths, interactions, selection mechanisms and corruption settings remain sealed from candidate development. This is strong research-process separation, not a completely secret external benchmark.

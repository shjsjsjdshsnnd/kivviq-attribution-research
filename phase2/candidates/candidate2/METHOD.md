# Candidate 2 method and falsification protocol

This protocol was committed **after the estimand/hypothesis preregistration and before estimator implementation**.

## One estimator family

Candidate 2 will implement one interpretable **AIPW** estimator. For each focal channel it combines:

1. an L2-regularized logistic outcome nuisance model;
2. an L2-regularized logistic treatment/propensity nuisance model;
3. the augmented inverse-probability estimating equation for the population-average signed conversion-probability effect.

No TMLE, DML, causal forest, boosted tree, neural network, stacking system or competing propensity/outcome architecture is part of Candidate 2.

## Scientific interpretation

The reason to test AIPW is not that it is assumed superior. It provides a genuinely new hypothesis versus Candidate 1: if observed covariates are informative about selection, combining treatment and outcome nuisance models may reduce selection-driven error when at least one nuisance model is sufficiently specified.

**Doubly robust does not mean robust to unobserved confounding.** Hidden purchase intent can still violate exchangeability and bias the estimator.

## Propensity and overlap policy

Raw propensities are always diagnosed. For the AIPW denominator only, propensities are clipped to **[0.025, 0.975]**. This rule is frozen before development and will not be tuned.

Required diagnostics include treatment prevalence, propensity quantiles, extreme-propensity fraction, treated/control inverse-weight effective sample size, maximum inverse weight and nuisance convergence.

## Nuisance development

The only tunable nuisance hyperparameters are the L2 penalties:

- outcome L2: 0.1, 1.0, 5.0
- propensity L2: 0.1, 1.0, 5.0

Selection uses the six declared **DEVELOPMENT** worlds only. Frozen Phase 1 and both Candidate 1/Candidate 2 holdouts are excluded.

## Uncertainty

Candidate 2 uses a nominal 90% normal interval based on the empirical standard error of the AIPW pseudo-outcome/influence values. Finite-sample nuisance-estimation uncertainty is not magically removed; undercoverage is a falsifiable failure mode.

## Frozen Phase 1 gate

The primary public selection-bias criterion is comparative rather than copied from Candidate 1 thresholds: Candidate 2 must reduce aggregate known-zero error versus frozen Candidate 1 across the same demand-capture, retargeting-selection, high-intent-null and retargeting-null Phase 1 cases, and improve at least three of those four scenario means.

Additional independently declared absolute/robustness criteria are in `protocol.json`.

## Sealed holdout gate

Every holdout family uses one common ex-ante effect-error bound rather than family-specific tuning:

- MAE <= 0.09;
- full channel coverage;
- at least 7/8 channel truths inside the nominal 90% interval;
- mean interval width <= 0.35;
- extreme raw propensity fraction <= 0.25;
- minimum treated/control effective sample size >= 8;
- finite valid outputs.

These thresholds were not derived from Candidate 1's sealed holdout results.

Observed-selection and hidden-confounding results are reported separately and never blended.

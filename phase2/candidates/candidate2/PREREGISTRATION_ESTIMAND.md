# Candidate 2 preregistration — estimand and hypothesis

**Candidate ID:** `candidate2-aipw-dr-observable`  
**Version:** `1.0.0`  
**Status:** ESTIMAND AND HYPOTHESIS PREREGISTERED BEFORE ESTIMATOR IMPLEMENTATION

The evaluator-only holdout `candidate2-holdout-v1` was instantiated and sealed before this candidate branch existed. Its private seal is not committed to Git. Only its public fingerprints and family manifest are copied into this branch.

## Estimand

Candidate 2 targets a **population-average signed incremental conversion-probability effect per synthetic channel** over the 21-day observation horizon.

For each focal channel, treatment is binary observable exposure before the qualifying outcome/horizon. The intervention sets focal exposure present; the comparison sets it absent while retaining the declared observable non-focal exposure/history pattern as the controlled background regime. The unit is the synthetic subject and the aggregation target is the population-average probability difference.

This is not descriptive attribution.

## Observable adjustment variables

Candidate 2 may use only candidate-visible observables:

- non-focal observed channel exposure indicators;
- observable pre-outcome touch count;
- observable session count;
- normalized timing summaries from observable pre-outcome touches;
- identity confidence;
- consent observability;
- censoring/observation completeness.

It may not receive latent purchase intent, true treatment effects, counterfactual outcomes, hidden selection coefficients, hidden interactions, sealed holdout parameters/seeds, or oracle causal truth.

## Hypothesis

The falsifiable hypothesis is that a **doubly robust** estimator combining an outcome nuisance model with a treatment/propensity nuisance model may reduce error caused by **observed** treatment-selection mechanisms relative to the frozen Candidate 1 outcome-regression estimator, while retaining signed effects and calibrated uncertainty, when the identification assumptions hold and at least one nuisance model is sufficiently specified.

**Doubly robust does not mean robust to unobserved confounding.** If important purchase intent remains genuinely latent so that conditional exchangeability fails, Candidate 2 may remain biased.

Expected failure conditions include unobserved confounding, positivity failure, joint nuisance-model misspecification, measurement loss, sparse support, unsupported interactions/time variation, and numerical instability.

## Candidate 1 boundary

Candidate 1 remains permanently frozen as `REJECT`.

Its sealed-holdout family MAEs, coverage values, exact failure magnitudes, numerical thresholds and revealed relative family difficulty are prohibited as Candidate 2 development targets. Candidate 1 motivates only the general research questions of observable treatment selection, known-zero behavior, hidden confounding and uncertainty calibration.

## Holdout boundary

`candidate1-holdout-v1` is not reused.

`candidate2-holdout-v1` is a new evaluator-only instantiation. It was sealed before Candidate 2 implementation. Candidate 2 will receive at most one feedback-bearing exposure after freeze and frozen Phase 1 eligibility.

## Public holdout limitation

The holdout-family architecture is public because the repository is public. The instantiated holdout seeds, parameter values, treatment effects, latent-intent strengths, interactions, selection mechanisms and corruption settings remain sealed from Candidate 2 development. This is strong research-process separation, not a completely secret external benchmark.

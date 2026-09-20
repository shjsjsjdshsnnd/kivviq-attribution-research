# Candidate 1 preregistration

**Candidate:** `candidate1-observable-gcomp`  
**Version:** `1.0.0`  
**Status:** PREREGISTERED — estimator implementation does not exist in this commit.

## Estimand first

Candidate 1 targets **incremental conversion probability**, not descriptive conversion credit.

For each channel, the estimand is the population-average difference between predicted
21-day conversion probability under a binary intervention setting that channel exposure
present versus absent, one channel at a time.

The population is synthetic subjects with a declared 21-day observation horizon. The
unit is the synthetic subject. Treatment is binary observed channel exposure before the
qualifying outcome.

## Hypothesis

The falsifiable hypothesis is that a simple, interpretable multivariable logistic
outcome regression with g-computation can reduce selection-driven misallocation relative
to descriptive Phase 1 attribution by conditioning on observed co-exposures and declared
measurement covariates.

This is not assumed to be true. Strong latent-intent confounding is intentionally hidden
from Candidate 1 and may reject the hypothesis.

## Method selected after the estimand

One method only: **L2-regularized main-effects logistic outcome regression with
g-computation**.

The method was selected because it directly models the binary outcome probability,
produces signed channel effects, is inspectable, and maps directly to the declared
intervention contrast. It deliberately does not model interactions, heterogeneous
effects, neural representations, sequence embeddings, or latent simulator state.

No competing estimator family will be implemented under Candidate 1 version 1.0.0.

## Observable inputs

Candidate 1 may use only:

- binary channel exposure indicators derived from observed pre-outcome touches;
- binary qualifying conversion outcome;
- observation-window duration;
- identity confidence;
- censoring state.

Observed co-exposure indicators are adjustment covariates in the multivariable outcome
model.

## Explicitly hidden/oracle inputs

Candidate 1 never receives:

- true latent purchase intent;
- true treatment effects;
- oracle counterfactual outcomes;
- hidden selection coefficients;
- hidden interaction effects;
- sealed holdout parameters or seeds.

## Representability

- Negative average effects: **yes**.
- Heterogeneous effects: **no explicit heterogeneous-effect model**; output is marginal.
- Treatment interactions: **no**.
- Time-varying effects: **no**.

These omissions are expected failure modes, not post-hoc excuses.

## Uncertainty target

Two-sided deterministic subject-level nonparametric-bootstrap percentile intervals for
every channel-level incremental-probability estimate.

## Fixed implementation parameters

- L2 penalty: 1.0
- Newton iterations: 40 maximum
- coefficient convergence tolerance: 1e-8
- probability clipping: 1e-6
- bootstrap replications: 32

These values are frozen before estimator implementation. Development may expose a
numerical defect, but Phase 1 or holdout performance may not be used to tune them.

## Development worlds

Only these candidate-visible worlds may be used before freeze:

1. `candidate1-dev-randomized-v1`
2. `candidate1-dev-observed-selection-v1`
3. `candidate1-dev-null-effect-v1`

Development usage is recorded in the candidate declaration and development record.

## Frozen Phase 1 falsification criteria

Before sealed holdout evaluation, Candidate 1 must satisfy all of the following:

- demand-capture Google Brand absolute estimated effect <= 0.03;
- retargeting-selection Meta absolute estimated effect <= 0.03;
- null-paid Pinterest absolute estimated effect <= 0.03;
- harmful-channel Pinterest estimate must be negative;
- every evaluated case must return finite estimates and uncertainty;
- 50% missing-touch degradation must not change the channel-effect vector by more than
  0.20 mean absolute channel difference relative to the corresponding perfect case;
- sample-size 80 evaluation must remain numerically valid.

The 0.03 null-effect tolerance was chosen before Candidate 1 implementation as a
three-percentage-point absolute probability-effect tolerance. The 0.20 degradation
criterion is intentionally permissive and exists to reject numerical/pathological
instability rather than guarantee performance.

## Sealed holdout gate

Every public holdout family is required. For each family:

- mean absolute effect error <= 0.12;
- channel coverage = 1.0;
- bootstrap interval coverage >= 0.75.

These thresholds are frozen before estimator implementation and before any sealed
holdout exists for Candidate 1.

## Public holdout limitation

The holdout-family architecture is public because this is a public research repository.
The instantiated holdout seeds, parameter values, treatment effects, latent-intent
strengths, interactions, selection mechanisms, and corruption settings remain sealed
from Candidate 1 development.

This is strong research-process separation, **not** a completely secret external
benchmark.

## Outcome rule

The final outcome is exactly one of:

- `SURVIVE`
- `REJECT`
- `INCONCLUSIVE`

Any required Phase 1 falsification failure, robustness failure, numerical-invalidity
failure, or sealed-holdout rejection produces `REJECT`. Missing required evidence
produces `INCONCLUSIVE`.

Candidate 1 will not be modified after its first feedback-bearing holdout evaluation.

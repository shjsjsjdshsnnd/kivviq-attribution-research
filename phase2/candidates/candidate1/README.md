# Candidate 1 preregistration

Candidate ID: `candidate1-outcome-regression-gcomp`  
Version: `1.0.0`

This directory was created **before estimator implementation**.

Research order:

1. Estimand defined.
2. Falsifiable hypothesis declared.
3. One interpretable method family selected because it matches the estimand.
4. Development-only hyperparameter grid and selection rule declared.
5. Falsification, robustness, uncertainty and numerical-validity criteria declared.
6. Estimator implementation comes only after this preregistration commit.

Candidate 1 targets population-average **incremental conversion probability**, not descriptive attribution credit.

The selected research hypothesis is ridge-regularized logistic outcome regression followed by g-computation. It may adjust observed co-exposure structure but it cannot observe latent purchase intent. Hidden-intent selection is therefore an explicit falsification risk rather than something the candidate is allowed to solve with oracle features.

No sealed holdout has been accessed. No frozen Phase 1 result is used to select the method or hyperparameters.

The public holdout-family architecture is visible by design. Exact instantiated seeds, effects, selection strengths, interactions and corruption settings remain evaluator-only during candidate development.

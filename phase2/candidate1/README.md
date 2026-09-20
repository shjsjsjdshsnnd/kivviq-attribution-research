# Candidate 1 preregistration

Candidate ID/version: `phase2-candidate1-aipw@1.0.0`

This directory begins with the estimand and falsifiable hypothesis only. No estimator implementation exists in this preregistration commit.

The target is a component-wise **incremental conversion-probability** estimand over a 21-day synthetic observation window. Candidate 1 asks whether an interpretable treatment-effect estimator using only the observable co-exposure vector can reduce selection-driven synthetic causal-recovery error.

The hypothesis is deliberately limited. Hidden latent intent, weak positivity, unmodeled interactions, temporal effects, sparsity, identity loss, and measurement corruption are declared failure risks before implementation.

The holdout-family architecture is public. Instantiated holdout seeds, parameters, treatment effects, latent-intent strengths, interactions, selection mechanisms, and corruption settings remain sealed from candidate development. This is research-process separation, not a fully secret external benchmark.

# Candidate 3 estimator implementation

Candidate 3 implements one interpretable estimator family:

**logistic propensity model + overlap weighting**

For each explicit focal-channel treatment decision opportunity:

- estimate `e(X_t)` from the frozen treatment-time-indexed pre-treatment features;
- treated overlap weight = `1-e(X_t)`;
- control overlap weight = `e(X_t)`;
- estimate the overlap-population conversion effect as the weighted treated conversion rate minus the weighted control conversion rate.

No outcome regression, AIPW, TMLE, causal forest or full-population ATE estimator is part of Candidate 3.

The implementation mechanically validates feature provenance before model fitting. A post-treatment timestamp causes `ABSTAIN_PRETREATMENT_INVALID`; it is never silently discarded or treated as baseline.

The full estimator always requests the frozen **400-refit bootstrap**. Ordinary CI tests the point/provenance path and verifies that attempts to reduce the bootstrap count fail. The Candidate 3 research development workflow runs the complete 400-refit uncertainty protocol.

Development may tune only the logistic propensity L2 penalty over the declared grid `0.1, 1.0, 5.0`. Candidate 3 holdout data, Candidate 1/2 holdouts and frozen Phase 1 are prohibited from development selection.

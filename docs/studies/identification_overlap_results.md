# Identification & Overlap Study — results

## Status

This is a **candidate-independent diagnostic study**, not Candidate 3.

Frozen boundaries remained unchanged:

- Phase 1: `1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf`
- Phase 2 harness: `3616d00c0855a0d3d9dcb8dbf578a3e68c26f9fa`
- Candidate 1: permanently `REJECT`
- Candidate 2: permanently `REJECT`
- Candidate 1 sealed holdout: not accessed
- Candidate 2 sealed holdout: not accessed
- Candidate 3: not implemented

The completed study contains **486 synthetic runs** aggregated into **243 recoverability-map cells** across:

`selection strength × focal prevalence/overlap anchor × latent confounding × sample size × measurement quality`

Each structural cell also has a perfect-measurement `n=5000` reference used to separate finite-sample estimability from large-sample recoverability.

## Primary diagnostic taxonomy

| Primary limitation | Cells | Share |
| --- | ---: | ---: |
| Positivity/support limitation | 101 | 41.6% |
| No dominant limitation | 100 | 41.2% |
| Finite-sample limitation | 14 | 5.8% |
| Measurement limitation | 11 | 4.5% |
| Observable-information limitation | 9 | 3.7% |
| Structurally non-identifiable | 8 | 3.3% |
| Estimator/specification limitation | **0** | **0.0%** |

These are preregistered primary labels. Secondary flags remain available; a primary label does not erase coexisting hidden-confounding, support or information-gap evidence.

The absence of an estimator/specification primary label does **not** prove that estimator specification can never matter. It means no study cell satisfied the preregistered rule for making estimator/specification the dominant diagnosed mechanism.

## 1. Strong treatment selection became an overlap/support problem

At selection strength `2.5`, **all 27 perfect-measurement cells** were classified as positivity/support limitations.

In the `n=5000` references, true-propensity extremity was substantial:

- prevalence anchor 0.15: roughly 23–24% of propensities outside the fixed overlap region;
- prevalence anchor 0.50: roughly 14–15%;
- prevalence anchor 0.85: roughly 23–25%.

This occurred even when latent intent had **zero outcome effect**, demonstrating that the support problem is not merely hidden confounding in disguise.

Interpretation: when treatment assignment becomes sufficiently selective, changing estimators is not the first-order solution. The full-population treatment contrast itself becomes weakly supported.

## 2. Moderate selection plus latent intent exposed missing identifying information

The most informative large-sample cells used selection strength `1.25` with strong latent-intent outcome weight `1.70`.

Across the three prevalence anchors:

- observable-only diagnostic absolute error: **0.1167–0.1636**
- oracle diagnostic absolute error: **0.0002–0.0073**
- oracle true-propensity extreme fraction: only **0.26%–6.44%**

So these worlds were not primarily suffering from severe structural overlap failure. When the diagnostic was allowed to use latent intent and true propensity, causal recovery was nearly exact at large sample. With candidate-visible information only, substantial error remained.

At latent-intent weight `0.85`, the same pattern was already visible:

- observable error: **0.0495–0.0690**
- oracle error: **0.0003–0.0040**
- oracle propensity extremity: **0.32%–6.10%**

This is evidence that some remaining error is information/identification related rather than simply an AIPW tuning problem.

## 3. Treatment predictability alone was not enough

A useful diagnostic result is that observable treatment prediction could sometimes be reasonably strong even when observable causal recovery remained poor.

That matters because predicting treatment assignment is not equivalent to satisfying conditional exchangeability. Candidate-visible journey variables may carry treatment-selection signal without containing enough information to remove outcome confounding.

The study therefore keeps treatment predictability, oracle support and causal-recovery error as separate outputs rather than using propensity-model fit as a proxy for identification.

## 4. Finite-sample estimability was distinct from identification

Finite-sample limitations appeared in **14 cells**:

- sample size 80: **10**
- sample size 250: **3**
- sample size 800: **1**

These cells were classified only when the corresponding large-sample reference was recoverable but the smaller perfect-measurement sample was not.

This is the intended distinction: an effect can be identifiable/recoverable in principle while still being practically unstable because the realized sample contains too little effective information.

## 5. Measurement loss produced a separate failure mechanism

Measurement limitations appeared in **11 cells**:

- 25% missing touches: **7**
- fragmented identity: **4**
- perfect measurement: **0**

These classifications require a matched perfect-measurement sample to be recoverable while corruption materially increases recovery error.

This separates "the information does not exist in the observable design" from "the information exists but measurement removes it."

## 6. Structural hidden-common-cause evidence remains visible even when it is not the primary label

The DGP structural flag identifies **108 of 243 cells** in which latent intent directly affects both focal treatment assignment and the outcome.

Only **8 cells** received the strict primary label `structurally_non_identifiable`, and **9** received `observable_information_limitation`. Other hidden-common-cause cells were dominated by support, finite-sample or measurement rules.

This is intentional: the map reports a primary diagnosed bottleneck while preserving structural flags instead of pretending mechanisms are mutually exclusive.

Under the study's stated backdoor-style identification assumptions, a hidden common cause means ordinary conditional exchangeability on the permitted observables does not hold. The oracle analysis is used to diagnose this; it does not authorize latent intent as a future candidate feature.

## Oracle boundary

The oracle layer used latent intent and the DGP true focal propensity **only inside this study**.

Tests verify that:

- the instrumented generator produces exactly the same observable world and manifest as the frozen Phase 1 generator;
- recording latent intent consumes no additional random draws;
- raw oracle subject records are not persisted in study output;
- oracle variables are not added to `phase2_candidate_sdk`;
- Candidate 1/Candidate 2 holdouts are never accessed.

Oracle variables must not be turned into Candidate 3 features or proxies merely because they improve synthetic recovery.

## What this study says before Candidate 3

The results do **not** support a simple "try a better AIPW" response to Candidate 2.

They diagnose at least three distinct research regimes:

1. **Strong selection / weak support:** investigate whether the target should become overlap-aware, restricted to a support population, or explicitly abstain outside support.
2. **Adequate support / latent common cause:** investigate whether richer *legitimately observable pre-treatment information* can satisfy a defensible identification strategy, or whether the target must be treated as non-identifiable/partially identified from the permitted data.
3. **Adequate large-sample recoverability / small samples:** treat the problem as finite-sample estimability rather than changing the causal estimand or adding hidden proxies.

Measurement-corrupted cases form a fourth, separate engineering/research problem: preserve or model the loss of information rather than confusing it with structural identification.

## Limitations

- The taxonomy is a preregistered diagnostic framework, not a mathematical theorem proving identifiability from empirical error alone.
- The fixed diagnostic estimator is not Candidate 3 and is not optimized to win the simulator.
- Candidate-visible journey features can be predictive without constituting a valid causal adjustment set; treatment predictability is diagnostic only.
- Primary limitation labels use precedence rules and therefore must be read together with secondary flags.
- All conclusions concern this synthetic public DGP and do not establish real-world causal validity.

## Research boundary

No Candidate 3 method, estimand or implementation is selected by this study.

The study's purpose is to make the *next hypothesis* depend on a diagnosed failure mechanism rather than on Candidate 2's numerical failure.

# Identification & Overlap Study protocol

This is a **candidate-independent study**, not Candidate 3.

## Question

Is remaining synthetic selection error primarily caused by estimator/specification limitations, weak positivity/support, missing observable information, finite-sample instability, measurement loss, or structural non-identifiability under the permitted observable information?

## Frozen boundaries

- Phase 1 remains frozen at `1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf`.
- Phase 2 harness remains the reference at `3616d00c0855a0d3d9dcb8dbf578a3e68c26f9fa`.
- Candidate 1 remains REJECT.
- Candidate 2 remains REJECT.
- Candidate 1 and Candidate 2 sealed holdouts are not accessed.
- Candidate 3 is not implemented.

## Study matrix

The public matrix is fixed before execution:

- focal channel: Meta (synthetic Phase 1 channel identifier only);
- selection strength: 0.0, 1.25, 2.5;
- focal prevalence/overlap anchor: 0.15, 0.50, 0.85;
- latent-intent outcome weight: 0.0, 0.85, 1.70;
- sample size: 80, 250, 800;
- measurement quality: perfect, 25% missing touches, fragmented identity;
- public seeds: 17 and 41.

Each structural cell also receives a perfect-measurement large-sample diagnostic reference at n=5000. This explicitly separates identification/support from finite-sample estimability.

## Frozen simulator use

The study calls the frozen Phase 1 generator directly. An instrumented RNG records the latent-intent draw without consuming any additional randomness; tests require the resulting observed dataset and manifest to be exactly equal to the uninstrumented frozen generator for the same config.

No Phase 1 source is modified.

## Oracle diagnostic boundary

Oracle analysis may use:

- the latent-intent draw;
- the true focal treatment propensity implied by the public DGP.

It is **diagnostic only**.

Oracle values:
- are not serialized as raw subject-level study output;
- are not added to `phase2_candidate_sdk`;
- are not candidate features;
- must not become Candidate 3 proxies merely because they improve recovery.

Only aggregate oracle diagnostics are persisted.

## Diagnostic estimator

The study uses one fixed cross-fitted AIPW diagnostic with L2=1.0 and three folds. It is not a research candidate. The observable diagnostic uses only candidate-visible journey features; the oracle version uses the same model plus latent intent and the DGP true treatment propensity.

The diagnostic is intentionally fixed rather than tuned.

## Outputs

Each cell reports separately:

- observable and oracle causal-recovery error;
- observable and oracle treatment predictability;
- propensity extremity;
- treated/control effective sample size;
- covariate balance before and after observable weighting;
- interval behavior;
- numerical validity;
- structural unobserved-common-cause flag.

## Taxonomy

The primary diagnostic taxonomy is preregistered:

1. **Estimator/specification limitation** — adequate support, no material missing-information signal, but the fixed large-sample diagnostic remains poor.
2. **Positivity/support limitation** — true propensity extremity exceeds 10% or minimum oracle arm ESS is below 10% of observed rows.
3. **Observable-information limitation** — oracle information materially improves treatment prediction/recovery while candidate-visible information remains insufficient.
4. **Finite-sample limitation** — the large-sample perfect-measurement observable diagnostic has error <=0.03 but a smaller perfect sample has error >0.05.
5. **Measurement limitation** — the matched perfect-measurement sample has error <=0.05 and corruption increases absolute recovery error by at least 0.03.
6. **Structurally non-identifiable** — a latent common cause drives both treatment and outcome, the oracle diagnostic recovers (<=0.03 error), observable large-sample recovery remains poor (>0.05), observable treatment-predictability gain is <=0.01, and oracle predictability gain is >=0.03.

Cells not meeting a dominant failure rule are labelled `no_dominant_limitation`.

Secondary flags are retained so a primary label does not erase coexisting overlap, hidden-common-cause or information-gap evidence.

## Important interpretation

Treatment predictability is a diagnostic of information/support, not proof of causal identification. Some candidate-visible journey features may be predictive without forming a valid backdoor adjustment set. Structural identification is therefore evaluated separately from predictive performance.

This study cannot authorize a Candidate 3 method. It only diagnoses which research question Candidate 3 should eventually test.

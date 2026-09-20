# Candidate 1 final research report

Candidate: `candidate1-outcome-regression-gcomp` v`1.0.0`

## DEVELOPMENT

The preregistered ridge grid was evaluated on development worlds only. Ridge λ=1.0 was selected before frozen Phase 1 or holdout evaluation.

Development mean effect MAE at λ=1.0: **0.0272**.

## FROZEN_PHASE1

- Perfect-observation mean effect MAE: **0.0186**
- Mean interval coverage: **0.8988**
- Missing-25 effect-vector divergence: **0.0765**
- Missing-50 effect-vector divergence: **0.1510**
- Harmful-channel negative sign: **PASS**
- Known-zero/selection criterion: **FAIL**

Candidate 1 failed its preregistered known-zero-effect requirement under demand capture and intent/retargeting selection. It was not modified.

## SEALED_HOLDOUT

Holdout version: `candidate1-holdout-v1`

| Family | MAE | Max error | Effect coverage | Interval coverage | Interval width | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| selection_shift | 0.0454 | 0.1558 | 1.000 | 0.875 | 0.1695 | evaluated |
| latent_intent_shift | 0.0823 | 0.1807 | 1.000 | 0.625 | 0.2213 | evaluated |
| prevalence_ordering_shift | 0.0505 | 0.1415 | 1.000 | 0.875 | 0.2231 | evaluated |
| time_varying_delayed | 0.0572 | 0.0768 | 1.000 | 0.875 | 0.1754 | evaluated |
| unseen_interaction | 0.0385 | 0.0811 | 1.000 | 0.750 | 0.1615 | evaluated |
| negative_heterogeneous | 0.0312 | 0.0712 | 1.000 | 0.875 | 0.1242 | evaluated |
| sparse_identity_loss | 0.0409 | 0.1334 | 1.000 | 1.000 | 0.1741 | evaluated |
| compounded_measurement | 0.0507 | 0.1147 | 1.000 | 0.875 | 0.1473 | evaluated |

Sealed holdout gate: **REJECT**.

## Robustness and uncertainty

Robustness was preregistered and evaluated without methodology changes: repeated Phase 1 seeds, sample-size/sparsity checks, 25%/50% missing touches, identity/cookie/censoring conditions, and sealed holdout selection, temporal, interaction, negative/heterogeneous, sparse-identity and compounded-measurement families.

Candidate uncertainty is an approximate 90% model-based Wald/delta interval. The evaluator—not Candidate 1—scores interval coverage against synthetic oracle truth.

## Holdout limitation disclosure

The holdout-family architecture is public because this is a public research repository. Instantiated holdout seeds, parameter values, treatment effects, latent-intent strengths, interactions, selection mechanisms, and corruption settings remain sealed from candidate development. This provides strong research-process separation but is not equivalent to a completely secret external benchmark.

## Limitations

- The outcome model uses additive binary channel indicators and does not explicitly model interactions or time-varying effects.
- Hidden purchase intent is intentionally unavailable; conditional exchangeability can fail.
- Wald/delta uncertainty conditions on the fitted outcome-model specification.
- Synthetic causal recovery does not establish real-world causal validity.

## Final outcome

**REJECT**

Reasons:
- FROZEN_PHASE1 preregistered criteria failed: known-zero/selection behavior.
- latent_intent_shift: interval_coverage_fraction failed preregistered gte 0.75

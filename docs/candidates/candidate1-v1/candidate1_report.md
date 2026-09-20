# Candidate 1 Phase 2 research result

**Candidate:** candidate1-stratified-lpm @ 1.0.0
**Frozen source fingerprint:** 81bac36011c6f84cc9042d5db85ef8205c33b2340815c712afe47daf226d1769
**Final outcome:** **REJECT**

## Public holdout limitation

The holdout-family architecture is public because this is a public research repository. Instantiated holdout seeds, parameter values, treatment effects, latent-intent strengths, interactions, selection mechanisms, and corruption settings remain sealed from candidate development. This provides strong research-process separation but is not equivalent to a completely secret external benchmark.

## Frozen Phase 1

- Gate passed: False
- Cases evaluated: 290
- Overall mean absolute error: 0.0356
- Retargeting-selection target error: 0.0546
- Demand-capture target error: 0.1088
- Null-paid target error: 0.0283

## Sealed holdout

- Version: holdout-v1
- Feedback exposure consumed: False
- Gate outcome: INCONCLUSIVE

| Family | MAE | Max error | Coverage | Interval coverage | Mean width |
| --- | ---: | ---: | ---: | ---: | ---: |

## Robustness

Robustness uses only the preregistered frozen Phase 1/public synthetic cases; the methodology was fixed before sealed-holdout exposure.

## Interpretation

SYNTHETIC CAUSAL RECOVERY is evidence about declared synthetic worlds only. This result is not production readiness, real-world causal accuracy, or proven incrementality.

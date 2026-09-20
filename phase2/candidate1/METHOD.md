# Candidate 1 method and preregistered falsification protocol

## Selected estimator

Candidate 1 uses one method only: **augmented inverse-probability weighting (AIPW)** with deterministic ridge-logistic nuisance models.

For each observed channel:

1. treatment is binary channel presence in the subject's pre-outcome exposure vector;
2. adjustment variables are binary indicators for the other observed channels;
3. a ridge-logistic propensity model estimates treatment probability;
4. separate ridge-logistic outcome regressions estimate conversion probability under treated and untreated states;
5. the AIPW influence expression estimates the population-average component-wise incremental conversion-probability effect;
6. the empirical influence-function variance produces a 95% normal interval.

The estimator is signed. It does not include explicit treatment-interaction terms, latent intent, oracle variables, or time-varying treatment effects.

## Fixed numerical choices

- ridge penalty: 0.02
- propensity clipping: [0.05, 0.95]
- gradient iterations: 500
- gradient learning rate: 0.15
- interval multiplier: 1.96

These are fixed for numerical stability before frozen Phase 1 or sealed-holdout evaluation. Candidate 1 does not compare competing estimator families or tune against holdout output.

## Phase 1 falsification checks

Before sealed holdout exposure, Candidate 1 will report separately:

- synthetic causal-recovery MAE on frozen Phase 1 cases;
- selection-bias worlds, especially demand capture and retargeting selection;
- error on truly null channels;
- signed recovery on harmful/negative-effect worlds;
- missing-touch degradation;
- identity fragmentation;
- sparse sample behavior;
- uncertainty coverage where simulator truth is known.

No Phase 1 result will be blended with holdout results.

## Sealed holdout gates

The machine-readable declaration preregisters family-specific MAE ceilings:

| Holdout family | Maximum MAE |
| --- | ---: |
| selection shift | 0.08 |
| latent-intent shift | 0.12 |
| prevalence/ordering shift | 0.10 |
| time-varying/delayed | 0.15 |
| unseen interaction | 0.15 |
| negative/heterogeneous | 0.15 |
| sparse identity loss | 0.18 |
| compounded measurement | 0.18 |

The primary selection-shift threshold is intentionally stricter because selection bias is the central Candidate 1 hypothesis. The 0.08 ceiling means an average absolute error of at most eight conversion-probability points across the hidden channel effects. The broader-family ceilings are looser where Candidate 1 explicitly lacks the corresponding structural model; they remain falsification thresholds, not claims of production usefulness.

Invalid output, unsupported required families, or missing uncertainty are rejection conditions under the harness.

## Public holdout limitation

The holdout-family architecture is public because this is a public research repository. Instantiated seeds, parameter values, treatment effects, latent-intent strengths, interactions, selection mechanisms, and corruption settings remain sealed from candidate development. This is strong research-process separation, not a completely secret external benchmark.

# Candidate 1 frozen Phase 1 evaluation

- Candidate: candidate1-observable-gcomp 1.0.0
- Frozen source commit: ad5f49097b1572087c10dffd7558e69287299099
- Phase 1 reference: 1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf
- Pre-holdout gate: **REJECT**
- Sealed holdout: **NOT_RUN_CANDIDATE_REJECTED_BEFORE_HOLDOUT**
- Holdout exposure consumed: **False**

## Preregistered Phase 1 checks

| Check | Pass | Detail |
| --- | --- | --- |
| demand_capture:google_brand:null_tolerance | False | estimate=0.05694973243525049, threshold=0.03 |
| harmful_channel:pinterest:negative | True | estimate=-0.010778582315510033 |
| measurement_loss:missing_50 | True | mean_absolute_channel_change=0.016960821983677696, threshold=0.2 |
| null_paid_channel:pinterest:null_tolerance | True | estimate=0.003619128811525146, threshold=0.03 |
| retargeting_selection:meta:null_tolerance | True | estimate=0.005710959148864953, threshold=0.03 |
| small_sample_80:numerical_validity | True |  |

## Public holdout limitation

The holdout-family architecture is public because this is a public research repository. Instantiated holdout seeds, parameter values, treatment effects, latent-intent strengths, interactions, selection mechanisms, and corruption settings remain sealed from candidate development. This provides strong research-process separation but is not equivalent to a completely secret external benchmark.

This report is synthetic research only and makes no real-world causal claim.

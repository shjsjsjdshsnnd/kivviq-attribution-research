# Candidate 3 final research report

Final outcome: **INCONCLUSIVE**

- Estimand: ATO / overlap-population incremental conversion effect
- Full-population ATE estimated: **False**
- Feedback-bearing sealed-holdout exposures: **1**

## Sealed holdout criteria

- abstention_reason_accuracy: **FAIL**
- ato_targeting_accuracy: **FAIL**
- bootstrap_contract: **PASS**
- effect_estimation_decision_accuracy: **PASS**
- full_population_ate_null: **PASS**
- interval_coverage: **PASS**
- latent_confounding_disclaimer: **PASS**
- max_absolute_ato_error: **PASS**
- mean_absolute_ato_error: **PASS**
- overlap_boundary_behavior: **PASS**

## Family results

- adequate_overlap_recovery: decision=ESTIMATE_ATO, absolute ATO error=0.0180
- weak_full_support_overlap_recovery: decision=ESTIMATE_ATO, absolute ATO error=0.0235
- inadequate_overlap_abstention: decision=ABSTAIN_INADEQUATE_FINITE_SAMPLE
- finite_sample_abstention: decision=ABSTAIN_INADEQUATE_FINITE_SAMPLE
- measurement_provenance_abstention: decision=ABSTAIN_PRETREATMENT_INVALID
- latent_confounding_non_goal: decision=ESTIMATE_ATO
- overlap_boundary: decision=ESTIMATE_ATO
- heterogeneous_overlap_effect: decision=ESTIMATE_ATO, absolute ATO error=0.0020

Candidate 3 remains conditional on declared pre-treatment observables and does not claim to solve latent confounding.

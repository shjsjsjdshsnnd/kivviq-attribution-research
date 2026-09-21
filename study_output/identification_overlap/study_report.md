# Identification & Overlap Study

Candidate-independent diagnostic study. No Candidate 3 estimator is implemented.

## Taxonomy

- finite_sample_limitation: **14** cells
- measurement_limitation: **11** cells
- no_dominant_limitation: **100** cells
- observable_information_limitation: **9** cells
- positivity_support_limitation: **101** cells
- structurally_non_identifiable: **8** cells

## Oracle boundary

Latent intent and true propensities are used only inside the study diagnostic. They are never exported as candidate features or proxies.

## Recoverability map dimensions

- selection strength
- focal treatment prevalence / overlap anchor
- latent confounding strength
- sample size
- measurement quality

## Interpretation boundary

The taxonomy separates estimator/specification, positivity/support, observable-information, finite-sample, measurement and structural-identification limitations. A primary label does not erase secondary diagnostic flags.

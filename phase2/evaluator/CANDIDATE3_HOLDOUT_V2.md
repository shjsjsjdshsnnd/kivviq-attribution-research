# Candidate 3 holdout v2 design

Candidate 3 v1.0.0 and the consumed `candidate3-holdout-v1` remain immutable.

## Reason for v2

The v1 sealed evaluation was INCONCLUSIVE because the instantiated
`inadequate_overlap_abstention` family failed the evaluator-side design check:
the oracle classified that world as `ESTIMATE_ATO` instead of
`ABSTAIN_INADEQUATE_SUPPORT`.

Holdout v2 changes the evaluator world generator, not the estimator or frozen
Candidate 3 contracts. The inadequate-overlap family is made materially more
deterministic so it can satisfy the already-frozen support-abstention contract.

## Required pre-exposure validation

Before any Candidate 3 v1.0.0 exposure to v2:

1. Instantiate v2 with a fresh private seed.
2. Run evaluator-only design validation on every generated family.
3. Require every non-boundary family to match its preregistered oracle decision.
4. Specifically require `inadequate_overlap_abstention` to classify as
   `ABSTAIN_INADEQUATE_SUPPORT`.
5. Require the finite-sample family to classify as
   `ABSTAIN_INADEQUATE_FINITE_SAMPLE`.
6. Require measurement provenance to classify as
   `ABSTAIN_PRETREATMENT_INVALID`.
7. Seal the validated configuration and publish only fingerprints/public metadata.
8. Do not expose Candidate 3 to v2 unless all design checks pass.

No Candidate 3 estimator code, hyperparameters, thresholds, frozen contracts,
v1 results, or v1 exposure ledger may be changed as part of this repair.

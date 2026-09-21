# Candidate 3 frozen-contract proposal

**No Candidate 3 estimator is implemented in this branch.**

These four contracts must be frozen before `candidate3-holdout-v1` is instantiated.

## 1. ATO estimand

Candidate 3 targets the **average treatment effect in the overlap/equipoise population**:

`ATO = E[e(X_t)(1-e(X_t))(Y(1)-Y(0))] / E[e(X_t)(1-e(X_t))]`

where `X_t` is information available strictly before an explicit focal-channel treatment decision opportunity.

The unit is a synthetic **treatment decision opportunity**, not a generic final customer journey.

The full-population ATE is explicitly **NOT ESTIMATED** by Candidate 3.

Candidate 3 addresses support/positivity. It does **not** claim to solve unmeasured or latent confounding.

## 2. Treatment-time-indexed pre-treatment X

Every treated **and untreated** unit requires an explicit treatment-opportunity timestamp. An untreated customer's lack of exposure is not enough to invent a decision time.

Permitted feature families are:

- prior non-focal channel exposure indicators;
- prior touch count;
- prior completed-session count;
- prior channel recency;
- elapsed observation time before the decision opportunity;
- explicitly declared baseline covariates with certified pre-decision provenance.

Every event-derived feature must use only source events with:

`source_event_time < decision_time`

Explicitly forbidden include:

- touch count at/after treatment;
- subsequent sessions;
- later channels;
- checkout/cart behavior after the focal decision;
- conversion-path structure containing future events;
- conversion outcome/timestamp;
- identity information learned later;
- future measurement/censoring state;
- oracle-inspired latent-intent proxies.

A feature with missing temporal provenance is invalid; Candidate 3 must abstain rather than assume it is pre-treatment.

## 3. Support / abstention

Support and finite-sample information are deliberately separate.

### Structural/sample support diagnostics

- central propensity region: `[0.10, 0.90]`;
- minimum central-overlap fraction: **0.20**;
- normalized overlap mass: `4 * mean(e(X_t)(1-e(X_t)))`;
- minimum normalized overlap mass: **0.20**.

If either overlap condition fails:

`ABSTAIN_INADEQUATE_SUPPORT`

No full-population ATE is substituted.

### Finite-sample diagnostics

After support is adequate, require:

- treated count >= **20**;
- control count >= **20**;
- total overlap-weight ESS >= **80**;
- treated overlap-weight ESS >= **30**;
- control overlap-weight ESS >= **30**;
- observed outcome events >= **10**.

If these fail:

`ABSTAIN_INADEQUATE_FINITE_SAMPLE`

### Decision priority

1. invalid pre-treatment provenance → abstain;
2. inadequate overlap/support → abstain;
3. inadequate finite-sample information/uncertainty → abstain;
4. otherwise estimate ATO.

This precedence is frozen before the holdout.

## 4. Uncertainty

Candidate 3 uses a **90% ordinary decision-unit percentile bootstrap**.

- 400 bootstrap replicates;
- the complete estimation pipeline is refit in every replicate;
- deterministic seed derived from evaluation case ID + frozen lineage;
- at least **95%** of bootstrap replicates must be valid;
- maximum acceptable 90% interval width: **0.25** on the probability-effect scale.

Failure of bootstrap validity or excessive interval width yields:

`ABSTAIN_INADEQUATE_FINITE_SAMPLE`

## Output contract

When estimation is allowed, Candidate 3 must report:

- estimand: ATO / overlap-population incremental conversion effect;
- signed estimate;
- 90% interval;
- target population: overlap/equipoise population;
- full-population ATE: **not estimated**;
- support status;
- finite-sample status;
- identification statement: conditional on declared pre-treatment observables;
- explicit statement that Candidate 3 **does not solve latent confounding**.

When Candidate 3 abstains, it must return no causal estimate or interval.

## Experimental ordering

`freeze these contracts → seal candidate3-holdout-v1 → implement Candidate 3 → DEVELOPMENT → freeze estimator → FROZEN_PHASE1/public gate → one sealed holdout exposure`

The frozen Identification & Overlap Study may motivate these contracts, but its oracle variables may not become Candidate 3 features.

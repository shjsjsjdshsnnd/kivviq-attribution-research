# Step 11 — Retention, Repeat Purchase & Lifetime Value Acceptance

## Frozen foundation

Step 11 is built from exact frozen Step 10 head:

`e5c9027522916f65669e350843bb4bea969e559e`

Branch:

`step11/retention-ltv`

Draft PR:

`#33`

Validated implementation head before acceptance-document packaging:

`5ad5bdd2d29884dcf36503e763a2bd99ca917d5d`

Step 10 and every earlier frozen foundation remain unchanged.

## Research isolation

Step 11 is public and synthetic-only.

It does not use private Kivviq code, Maison Olive data, real merchant/customer data, production systems, credentials, production APIs or private implementation details.

No retention optimizer, acquisition optimizer, lifecycle-marketing optimizer, recommendation policy or production action system is included.

## Acceptance coverage

The validated implementation covers the supplied requirements through the file's truncation boundary:

- longitudinal customer economic ledger;
- strict realized/expected/oracle value separation;
- first-purchase state transition;
- heterogeneous time-dependent repeat-purchase hazard;
- merchant-aware time to second purchase;
- second and third+ purchases through normal Step 4 commerce;
- evaluator retention curves;
- customer and merchant heterogeneity;
- product-dependent retention, replenishment and cross-category/complement effects;
- Step 10 stockpiling integration;
- explicit lifecycle transition semantics;
- cadence-aware lapse, latent churn and permanent churn only when configured;
- reactivation;
- explicitly causal brand-affinity/customer-experience effects;
- post-purchase/lifecycle marketing without an optimizer;
- preserved email/retargeting selection bias;
- causal acquisition-quality treatment distinct from channel selection;
- first-order CAC/ROAS/revenue/contribution separated from future value;
- realized repeat contribution over 30/90/180/365-day horizons;
- explicit contribution-based CLV and revenue-LTV semantics;
- explicit horizons and optional discounting;
- expected-value uncertainty;
- returns/inventory/pricing/promotion interactions through existing Steps 7–10;
- subscription mechanics only when configured;
- evaluator cohorts with composition-vs-causality caveat;
- same-seed incremental customer-value counterfactual replay;
- per-customer acquisition counterfactual classifications;
- hard cheap-customer/high-LTV reversal;
- hard first-order ROAS reversal;
- hard observed-LTV selection trap.

## Deterministic hard traps

### Cheap customer / high-LTV reversal

**Channel A — Meta**

```
observed first-order CAC:                 2,816.90
first-order platform ROAS:                  15.49x
first-order contribution:                  98,349
365-day repeat contribution:                    0
expected remaining contribution:          117,264
expected total contribution after cost:   175,613
true incremental customer value:         -772,890
```

**Channel B — Pinterest**

```
observed first-order CAC:                 3,521.13
first-order platform ROAS:                  10.65x
first-order contribution:                 197,167
365-day repeat contribution:               69,623
expected remaining contribution:        6,807,977
expected total contribution after cost: 6,805,144
true incremental customer value:        3,619,388
```

Channel A is cheaper and has the stronger first-order platform ROAS, while Channel B has materially higher long-term customer value after acquisition economics.

This traps both lowest-CAC optimization and first-order-ROAS optimization.

### Observed LTV selection trap

The selected channel is Pinterest; comparison is Google Shopping.

Observed cohort value:

```
Pinterest:       8,146
Google Shopping: 4,630
```

But Pinterest's frozen causal channel effect in the trap is exactly:

`0`

and represented customer weight receiving a causal acquisition-quality treatment from Pinterest is:

`0`

The observed value difference persists solely because higher-value latent customers were made more likely to naturally select the zero-effect channel.

This demonstrates that observed cohort LTV does not identify causal customer quality.

## Validation at implementation head

CI run:

`35787168678`

Results:

- architecture boundary: PASS;
- strict TypeScript typecheck: PASS;
- focused Step 11 suite: **13 / 13 tests PASS** across 5 files;
- full inherited + Step 11 suite: **218 / 218 tests PASS** across 57 files;
- build: PASS.

No inherited tests were removed or skipped.

## Information boundary

The Step 11 evaluator report is marked `godModeOnly: true`.

True churn state, acquisition-treatment truth, customer-level counterfactual outcome labels, expected-value generative truth and future oracle outcomes remain evaluator-only.

The Operator-safe root is tested not to export Step 11 evaluator/counterfactual truth.

## Source-spec truncation

The supplied Step 11 request ends at section 50 after:

`This demonstrates:`

No unseen trailing text or acceptance criteria were invented.

## Freeze rule

After the acceptance-report packaging commit receives green exact-head CI, that commit becomes the frozen Step 11 head.

PR #33 remains draft, open and unmerged.

# Step 10 — Pricing & Promotion Economics Acceptance

## Frozen foundation

Step 10 is based on the exact frozen Step 9 head:

`269f66e16960f1f1a129fd3ff49acf9d1d7d6c55`

Branch:

`step10/pricing-promotions`

Draft PR:

`#27`

Step 9 and all earlier frozen research remain unchanged.

## Scope boundary

This step is public and synthetic-only.

No private Kivviq implementation, Maison Olive data, merchant/customer records, production systems, credentials, production APIs or private implementation details are used.

No pricing optimizer, promotion optimizer, recommendation engine or Operator decision policy is introduced.

The supplied Step 10 specification ends mid-section 50 after the words `Promotion A has`. This acceptance report therefore validates the requirements actually supplied through that truncation boundary and does not invent unseen criteria.

## Governing causal contract

Pricing is not modeled as:

`discount -> fixed conversion multiplier -> revenue`.

The implemented path is:

```
authoritative price / offer
        ↓
customer-specific nonlinear response
        ↓
purchase probability / timing / quantity / product choice
        ↓
basket / substitution / cross-sell
        ↓
Step 9 inventory
        ↓
returns / fulfillment
        ↓
Step 7 accounting
        ↓
same-seed counterfactual economics
```

## Implemented contracts

Validated Step 10 coverage includes:

- authoritative SKU/variant price state with regular/current/effective price, discount amount/percentage, currency and effective interval;
- frozen own-price elasticity with explicit constant-elasticity semantics `Q1/Q0 = (P1/P0)^e`;
- piecewise nonlinear price-response support;
- Step 3 customer heterogeneity, brand affinity, current need, urgency, deal orientation and latent reservation-price thresholds;
- category-level tendencies only with explicit synthetic provenance;
- sparse frozen cross-price effects;
- price increases as well as discounts;
- sitewide, category, collection, product-family and explicit-SKU promotion scopes;
- explicit synthetic collection/product-family membership where frozen merchant truth does not exist;
- percentage and fixed discounts;
- coupons with eligibility, minimum spend, awareness and redemption;
- free shipping distinct from product-price discounting;
- upward/downward free-shipping-threshold replacement;
- real-SKU bundles with component discount allocation, cannibalization and incremental attachment;
- loyalty/member offers using legitimate prior state rather than hidden future CLV;
- clearance vs wait counterfactual including Step 9 carrying cost/obsolescence;
- synthetic major-event demand separated from merchant-promotion causation;
- Step 6 promotion × channel interactions;
- Step 9 promotion × inventory interactions;
- explicit promotion-return modifiers only when declared;
- promotion-driven customer-composition/future-value effects through existing customer economics;
- pull-forward through customer need timing rather than manual post-sale subtraction;
- replenishment stockpiling only when explicitly eligible and extra quantity is actually bought;
- sparse promotion habituation/promotion waiting;
- same-seed no-promotion counterfactuals;
- incremental units/orders/gross revenue/net revenue/gross profit/contribution/new customers/future contribution;
- promotion attribution diagnostics separating during/exposed/redeemed/incremental/accelerated/would-have-bought-anyway/switched purchases;
- discount-cost decomposition across incremental, accelerated, would-have-bought-anyway and switched purchases;
- price and promotion response curves;
- evaluator-only finite-grid contribution-profit oracle answers;
- no-promotion as an explicit candidate.

## Deterministic acceptance traps

### Discount margin-destruction trap

A 10% sitewide discount produces different economics across two products.

Product A:

```
baseline units:               2,568.00
promoted units:               3,226.46
baseline contribution:       24,016,611
promoted contribution:       25,987,488
```

The high-response/high-margin product gains contribution.

Product B:

```
baseline units:                 658.46
promoted units:                 724.31
baseline contribution:        3,321,107
promoted contribution:        2,621,843
```

Demand rises, but not enough to repay margin sacrificed on units that would have sold anyway.

Across the trap, discount cost on would-have-purchased-anyway orders is `11,596,232` minor units versus `582,212` on genuinely incremental purchases.

### Revenue-winner / profit-loser trap

Response grid:

```
No promotion
net revenue:          33,466,859
contribution:          2,038,459

10% discount
net revenue:          50,997,910
contribution:            167,652

20% discount
net revenue:          95,960,883
contribution:         -7,262,592
```

The deepest discount wins revenue while destroying contribution.

The evaluator-only finite-grid oracle selects the no-promotion point for contribution profit.

### Pull-forward / post-promotion dip trap

The promotion produces `4.116` represented accelerated purchases under shared randomness.

Immediately after the promotion:

```
Jan 8–15 promoted revenue:    45,566
Jan 8–15 baseline revenue:    48,331
```

The post-promotion dip emerges from customer timing; no manual negative adjustment is applied.

Full-horizon incremental contribution is `-464,261` minor units.

The paired-order `postPromotionDisplacedPurchases` diagnostic is intentionally not required to be positive in this fixture because aggregate post-sale displacement is directly demonstrated by the shared-seed weekly factual/control path; the stricter customer-level accelerated-purchase diagnostic remains positive.

## Validation

Validated implementation head:

`2ff68e96523e37c6d59c89815bf3950b82db60be`

PR-triggered CI run:

`35670183146`

Results:

- architecture boundary: PASS;
- strict TypeScript typecheck: PASS;
- Step 10 focused suite: **26 / 26 tests PASS** across 4 files;
- full inherited + Step 10 suite: **205 / 205 tests PASS** across 52 files;
- build: PASS.

No inherited test was removed or skipped.

## Information boundary

Step 10 evaluator/oracle infrastructure remains on the explicit `./pricing-promotions` subpath.

The Operator-safe root does not export Step 10 oracle truth.

Dependency-cruiser forbids Operator-facing code from importing the pricing-promotions evaluator layer.

God-mode response curves, promotion attribution truth and finite-grid maximizing points therefore remain benchmark/evaluator truth rather than Operator inputs.

## Status

PR #27 remains open, draft, mergeable and unmerged.

No deployment or production change is part of Step 10.

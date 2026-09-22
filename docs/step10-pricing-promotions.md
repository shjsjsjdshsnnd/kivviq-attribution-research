# Step 10 — Pricing & Promotion Economics

Step 10 extends the synthetic Growth Operator research simulator with causal pricing and promotion economics. It is built from the frozen Step 9 head `269f66e16960f1f1a129fd3ff49acf9d1d7d6c55`.

This module is evaluator/God-mode research infrastructure. It is not a pricing optimizer, promotion optimizer, recommendation engine, decision policy, production integration, or merchant-facing implementation.

## Safety boundary

Step 10 is public and synthetic-only. It does not use private Kivviq code, Maison Olive data, merchant/customer records, credentials, production APIs, or production systems.

The frozen Step 1–9 execution path remains unchanged when `pricingPromotionScenario` is absent. The Operator-safe root does not export Step 10. Consumers must explicitly import the `./pricing-promotions` package subpath, and dependency-cruiser forbids Operator-facing modules from importing `pricing_promotions`.

## Causal ordering

Step 10 does not implement `discount -> fixed conversion lift -> revenue`.

The Step 10 path is:

```text
authoritative price / offer
        ↓
customer-specific nonlinear response
        ↓
product choice + purchase probability + timing + quantity
        ↓
basket and cross-sell/substitution
        ↓
Step 9 inventory reservation / fulfillment / stockout / backorder
        ↓
returns and fulfillment
        ↓
Step 7 economic waterfall
        ↓
same-seed evaluator counterfactual
```

The causal value of a promotion is the difference from the paired factual counterfactual, not revenue attributed to a promotion window.

## Authoritative price state

Each Step 10 SKU/variant price state distinguishes:

- regular/base price
- current selling price
- discount amount
- discount percentage
- effective price
- currency
- optional effective start/end

All monetary values use integer minor units. The evaluator validates that discount amount and percentage reconcile the current selling price to the effective price.

The Step 10 evaluator hydrates missing SKU price states from the governed Step 7 product-economic profiles, including declared product-economic overrides. It does not derive authoritative prices from diagnostics.

## Own-price response

Frozen GroundTruth price-elasticity mechanisms remain authoritative.

For constant own-price elasticity `e`, Step 10 uses:

```text
Q1 / Q0 = (P1 / P0)^e
```

This supports both price decreases and increases and is nonlinear by construction.

For frozen piecewise elasticity mechanisms, Step 10 linearly interpolates the declared relative-price / relative-demand points.

The merchant-level response is then moderated by Step 3 customer heterogeneity:

- price-sensitivity multiplier
- purchase urgency
- current purchase need
- brand affinity
- deal orientation

A stable latent customer-product reservation-price frontier adds threshold behavior. The reservation-price state remains God-mode latent state.

The final demand response remains positive and bounded.

## Cross-price effects

Sparse frozen cross-price mechanisms are applied only to declared source/target product relationships.

A source-product price increase can increase demand for a substitute target when the declared cross elasticity is positive. Complement relationships may have the opposite sign.

Step 10 does not create a dense all-product-pairs matrix.

## Promotion response

Promotion utility is separate from the pure price response. The promotion response is smooth and saturating rather than linear in discount depth.

Customer promotion response depends on Step 3 promotion sensitivity and deal orientation. Awareness is deterministic under the synthetic customer/promotion identity key.

Repeated historical promotion exposure may have a sparse habituation effect only when a promotion explicitly declares `habituationStrength`:

- promotional response may strengthen
- when no current offer exists, promotion-waiting probability can reduce immediate full-price utility

This mechanism is not universal and is not exposed to Operator.

## Promotion mechanics

Step 10 supports:

- percentage discounts
- fixed discounts
- coupons
- free shipping
- free-shipping threshold changes
- bundles
- loyalty percentage offers
- loyalty fixed credits
- member pricing
- clearance

Scopes support:

- sitewide
- category
- collection
- product family
- explicit SKU sets

Frozen Steps 1–9 do not contain an authoritative collection or product-family entity. Step 10 therefore supports explicit synthetic membership sidecars. When used, provenance is declared as `step10_explicit_synthetic_membership`; the simulator does not claim these sidecars are frozen merchant truth.

## Fixed discounts

Fixed discounts have explicit allocation semantics:

- `order`
- `per_eligible_unit`

Order-level fixed credits are allocated across eligible underlying SKU lines. They are not represented as fictional bundle/order revenue.

Minimum-spend qualification is evaluated from the cart before the qualified coupon/credit is realized.

## Coupons

Coupons can declare:

- percentage or fixed value
- scope
- minimum spend
- start/end
- targeting
- awareness probability
- redemption probability

Eligibility does not imply redemption. Coupon awareness/redemption is customer-specific and deterministic for a fixed synthetic seed/identity.

## Free shipping

Free shipping is not a product-price discount.

A free-shipping offer can leave product prices unchanged while setting the order-specific customer shipping charge to zero. Step 7 then records the merchant shipping cost through the existing shipping-subsidy accounting.

## Free-shipping thresholds

A `free_shipping_threshold` intervention replaces the prior threshold and therefore supports both directions:

- lower threshold, e.g. $150 → $100
- higher threshold, e.g. $100 → $125

The existing basket/checkout simulation reacts to distance from the active threshold, so customers may continue shopping, add another unit/item, or abandon according to their behavior. The threshold is not optimized.

## Bundles

Bundles are composed of real SKUs.

Bundle discounting can specify:

- required products
- discounted components
- percentage discount
- fixed bundle credit

The checkout resolver allocates the discount to component SKU lines. Existing product COGS, shipping, fulfillment, return, inventory, substitution, and complement structures therefore continue to apply.

Bundle promotion utility can affect basket formation through the existing customer/product choice process. The paired no-promotion counterfactual can therefore represent both:

- cannibalistic A+B purchases that would occur anyway
- incremental B attachment where control would contain A only

## Loyalty offers

Loyalty/member targeting is limited to state that exists before assignment, such as:

- new vs repeat state
- prior purchase count
- subscriber/member lifecycle state

Hidden future CLV is not a targeting input.

A strong loyalty redemption rate can therefore coexist with weak true incrementality if the paired control shows those customers would purchase anyway.

## Clearance

The Step 10 clearance evaluator runs the price intervention through Step 9 inventory and compares:

- clear now
- wait for full-price demand

The evaluator reports immediate contribution together with Step 9 carrying cost and obsolescence loss so clearance is not judged from immediate per-unit margin alone.

## Synthetic major events

Step 10 can declare synthetic major-event windows. No real Black Friday statistics are hard-coded.

A major event can independently specify:

- exogenous baseline-demand multiplier
- marketing-competition multiplier

Merchant promotions remain a separate intervention.

The evaluator can run three shared-seed worlds:

1. event demand + merchant promotion
2. event demand without merchant promotion
3. no event and no merchant promotion

This produces separate event-demand and merchant-promotion effects.

Increased event demand can naturally change customer composition, consume inventory, and create later need suppression when more customers purchase earlier. No manual post-event sales subtraction is applied.

## Promotion × marketing

Frozen Step 6 promotion interactions remain active because the Step 10 scenario feeds the existing `promotionActive` interaction context.

Step 10 can additionally declare explicit channel-response multipliers per promotion. Omitted channel interactions equal 1, so the model supports:

- synergy
- cannibalization
- zero direct interaction

Synthetic event marketing competition can change paid exposure opportunity at the same spend.

A customer may discover a promotion through email/paid media and later purchase through search/direct. The observed path remains distinct from promotion causation.

## Promotion × inventory

All Step 10 evaluator requests run with Step 9 inventory dynamics enabled.

Promotion can therefore:

- accelerate stockout
- consume scarce inventory
- increase lost demand
- increase substitution
- increase backorder pressure
- clear excess stock

Pricing/promotion does not bypass the Step 9 physical reconciliation ledger.

## Returns

Step 10 does not assume discounted orders have higher return rates.

When `returnProbabilityMultiplier` is omitted, promotion affects returns only indirectly through customer and product mix. When explicitly declared, the multiplier becomes a causal promotion-return mechanism.

The Step 9 physical-return path and the Step 7 non-inventory return evaluator both honor the Step 10 line-level modifier.

## Customer quality and future value

Promotions can change which latent customers convert because price sensitivity, deal orientation, brand affinity, need, and promotion responsiveness are heterogeneous.

The existing Step 7 customer-economics evaluator therefore captures changed expected future contribution from the selected customer mix. Step 10 does not hard-code that promotion-acquired customers are lower or higher quality.

## Purchase pull-forward

A promotion can convert a customer earlier than the same-seed no-promotion world.

Step 10 evaluator diagnostics classify a treated purchase as accelerated when the same customer/product purchase occurs later in control.

After purchase, existing customer need is reset. Step 10 can extend the next-need eligibility interval according to promotion pull-forward and replenishment stockpiling. Consequently a post-promotion dip emerges from customer purchase timing rather than from a manually subtracted adjustment.

## Stockpiling

Only promotions explicitly marked `stockpilingEligible` can raise extra-unit probability.

The response is strongest for replenishment-oriented customers/categories. Additional quantity also extends future need eligibility, reducing future replenishment demand in the same simulated customer state.

Stockpiling is not applied universally.

## Incremental promotion economics

The Step 10 report includes same-seed deltas for:

- units
- orders
- gross revenue
- net revenue
- gross profit
- contribution profit
- new customers
- expected future contribution

The no-promotion action is always representable.

## Promotion attribution diagnostics

Evaluator-only diagnostics distinguish:

- purchases during a promotion
- promotion-exposed purchases
- promotion-redemption purchases
- true incremental promotion purchases
- accelerated purchases
- purchases that would happen anyway
- switched-product purchases

Discount cost is separately assigned to:

- incremental purchases
- accelerated purchases
- purchases that would happen anyway
- switched purchases

These are counterfactual evaluator labels, not Operator observations.

## Product-level reconciliation

Step 10 emits product rows with:

- represented units
- gross revenue
- discounts
- allocated net revenue
- allocated gross profit
- allocated contribution profit

Order-level refunds/costs are allocated by line net-sales share. Final-line and final-product residual handling makes net revenue, gross profit, and contribution reconcile exactly back to the merchant waterfall.

This enables deterministic cases where the same 10% sitewide discount is economically attractive for one product and destructive for another.

## Response curves

God mode can evaluate declared grids such as:

Promotion depth:
```text
0%, 5%, 10%, 15%, 20%, 25%
```

Price level:
```text
-10%, -5%, baseline, +5%, +10%
```

Promotion response points report:

- represented units
- represented orders
- gross revenue
- net revenue
- gross profit
- contribution profit
- represented inventory consumption
- expected future contribution

Price response points report:

- represented units
- represented orders
- gross revenue
- gross profit
- contribution profit

The response-curve code evaluates known synthetic counterfactuals. It does not choose an action for Operator.

## Oracle-only grid answers

Evaluator/God mode may return the contribution-maximizing point among a finite declared grid for benchmark truth.

The result is explicitly `godModeOnly: true`.

This is not exported through the Operator root and is not a pricing/promotion recommendation engine. Its purpose is to establish known answers for future Growth Operator benchmarks.

## Source-spec boundary

The Step 10 request supplied for this build ends mid-section 50, after the line `Promotion A has` in “Revenue-winner / profit-loser trap.”

The implementation covers the requirements actually present through that point. It deliberately does not invent unseen text or acceptance criteria after the truncation boundary.

Deterministic trap outputs and exact validated commit/CI identifiers are recorded separately in the Step 10 acceptance report once the branch is frozen.

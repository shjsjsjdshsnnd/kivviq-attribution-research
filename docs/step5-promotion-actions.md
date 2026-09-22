# Phase 2 — Action Space
## Step 5 — Promotion Actions

## Governing principle

**A promotion is a structured business intervention with explicit mechanics, scope, eligibility, timing and economics. It is not prose saying to run a sale, and it is not a temporary regular-price mutation.**

Step 5 does not optimize promotions, forecast demand, rank recommendations, generate coupons, execute Shopify changes, build campaign messaging or implement a checkout engine.

## Schema version

Step 5 advances canonical Action schema to `1.3.0`.

Readers continue to accept genuine 1.0.0, 1.1.0 and 1.2.0 Actions. Step 1 fixtures remain pinned to 1.0, paid-media fixtures to 1.1 and pricing fixtures to 1.2. New promotion Actions emit 1.3. Promotion-only target/parameter/action types cannot masquerade as earlier schemas.

## Stable promotion identity

`promotion.start`, `promotion.stop` and `promotion.modify` target `{ kind: "promotion", promotionId }`.

Promotion IDs use stable `promo_*` identifiers. START stores the same promotion ID in `promotion_start.promotionId`; STOP/MODIFY reference it through `targetPromotionId`. Runtime validation requires the parameter identity to match the Action target.

Human-readable descriptions never identify an existing promotion.

## START / STOP / MODIFY

- `promotion.start` defines a new active promotion.
- `promotion.stop` is an instantaneous ACTIVE → INACTIVE business decision.
- `promotion.modify` is an instantaneous structured definition change.

START, STOP and MODIFY have separate Action types, parameter kinds, fingerprints and serialization.

Temporary START actions terminate by `DEACTIVATE_PROMOTION`. Ending a promotion never restores or mutates regular product prices.

## Pricing boundary

`pricing.adjust_price` changes regular price.

`promotion.start` leaves regular price intact and applies promotional mechanics.

Even when customer transaction price could be numerically identical, pricing and promotion remain separate in Action type, parameters, fingerprints, translation, measurement and termination semantics.

## Promotion mechanisms

Structured mechanisms include:

- `DISCOUNT` with `PERCENTAGE`;
- `DISCOUNT` with `FIXED_AMOUNT` money;
- `DISCOUNT` with `FIXED_PROMOTIONAL_PRICE` money;
- `BUNDLE_FIXED_PRICE`;
- `BUNDLE_PERCENTAGE_DISCOUNT`;
- `CONDITIONAL_ITEM_DISCOUNT`.

Percentage values are integer basis points in `(0, 10000]`. Monetary discounts/prices use integer minor units and explicit three-letter currency. Ambiguous numeric discounts are impossible by type.

## Scope and product eligibility

Promotion Actions target the promotion identity. Applicability is separately defined through structured promotion scope.

`PRODUCT_SCOPE` supports canonical SKU, product, category, collection, product-set and brand selectors. Inclusion and exclusion are separate arrays and require explicit `EXCLUDE_OVERRIDES_INCLUDE` precedence.

Product conditions include current inventory thresholds, clearance exclusion and excluded brand conditions.

`ORDER_SCOPE` and `BUNDLE_SCOPE` remain distinct.

Category/collection/product-set/brand scopes require explicit membership semantics because membership may change over time.

## Customer eligibility

Supported customer business rules include:

- ALL_CUSTOMERS;
- NEW_CUSTOMERS;
- RETURNING_CUSTOMERS;
- CUSTOMER_SEGMENT;
- EMAIL_SUBSCRIBERS;
- LOYALTY_SEGMENT.

Segment Actions carry membership-binding semantics; the Action never embeds a future customer list.

## Cart/order qualification

Structured purchase requirements include:

- minimum order value with explicit currency;
- minimum quantity;
- required canonical target and quantity;
- required bundle composition.

Bundle qualification uses explicit components and quantities.

## Redemption

Redemption is either:

- `AUTOMATIC`; or
- `COUPON`.

A coupon requires exactly one executable reference:

- predetermined `code`; or
- downstream `codeFamilyRef`.

Automatic and coupon promotions therefore produce different semantic fingerprints even with identical discount depth.

## Usage limits

Optional limits include:

- max total redemptions;
- max redemptions per customer;
- max discounted units per order;
- max promotional exposure in explicit currency.

Absent limit is distinct from explicit zero.

## Stacking and conflicts

Stacking is explicitly one of:

- STACKABLE;
- NON_STACKABLE;
- STACKABLE_WITH_TYPES.

Conflict policy can be:

- NONE;
- PRIORITY with explicit business precedence;
- BEST_DISCOUNT;
- MUTUALLY_EXCLUSIVE_GROUP.

`assessPromotionPairConflict` does not implement checkout pricing. It reports STACKABLE, RESOLVABLE or AMBIGUOUS from the configured business semantics.

Overlapping non-stackable promotions without compatible resolution return explicit ambiguity instead of silently stacking or choosing a winner.

## Economic constraints

Promotion safeguards reuse canonical Action constraints and precise post-promotion economic metrics:

- finance.gross_margin_rate_after_promotion;
- finance.gross_margin_per_unit_after_promotion_minor;
- finance.contribution_margin_rate_after_promotion;
- finance.contribution_per_unit_after_promotion_minor.

Missing COGS/contribution inputs remain tri-state eligibility `unknown`; they are not guessed.

## Deterministic eligibility

`evaluatePromotionEligibility` consumes only present facts supplied at the decision boundary:

- product taxonomy/current flags;
- current inventory facts;
- current customer classification/segment facts;
- current cart lines/subtotal;
- current redemption counters/exposure;
- explicit hard-constraint evaluation results;
- currently active promotion types.

It returns:

- eligible;
- ineligible;
- unknown.

Unknown membership, customer classification, margin evidence, cart state or redemption counters never collapse to false.

## Membership snapshots and replay

Step 5 reuses Step 4 membership-binding principles.

TranslationContext advances to `1.2.0` with optional `promotionMembershipBindings` containing:

- promotion ID;
- membership boundary;
- stable bindingRef;
- snapshot timestamp and source;
- canonical business members;
- simulator member targets.

Collection/category promotion replay therefore uses the frozen historical binding instead of current catalog membership.

Generated simulator interventions preserve promotion ID plus membership source, binding, boundary and snapshot time.

## Conservative Step 2 translation

The existing simulator has a distinct `promotion_discount` intervention, separate from regular-price mutation.

Step 5 uses it only when all business semantics can be preserved:

- START Action;
- automatic redemption;
- product scope;
- exactly one inclusion rule;
- no exclusions;
- no product conditions;
- ALL_CUSTOMERS;
- no cart requirements;
- no usage limits;
- STACKABLE;
- conflict policy NONE;
- discount mechanism is percentage or fixed amount.

Direct SKU/product scopes require simulator entity mapping.

Mutable category/collection/product-set/brand scopes require a deterministic promotion membership snapshot and expand into member interventions.

Coupon, bundle, fixed-promotional-price, customer-specific, limited, stacking-sensitive and other richer promotions return `UNSUPPORTED_SIMULATOR_CAPABILITY` rather than losing semantics.

STOP and MODIFY also return explicit unsupported lifecycle capability until the simulator gains native promotion deactivation/modification interventions.

At no point is a promotion translated into a regular-price `price` intervention.

## Information boundary

Promotion Actions reject embedded outcome/prediction fields including expectedDemandLift, expectedRevenue, expectedConversions, expectedProfit, expectedROAS, predictedRedemptions, predictedAOV, futureDemand, counterfactualRevenue, recommendationScore and confidenceScore.

The `promotion` business module is dependency-isolated from simulator internals, GroundTruth, product-economics God-mode modules, evaluator/oracle and optimizer layers.

## Canonical fixtures

Fixtures cover:

1. automatic 15% Collection X for four days;
2. CAD 100 off Product A;
3. FALL15 coupon for Collection X;
4. 15% off orders >= CAD 1,000;
5. new-customer 20%;
6. VIP Segment A 20%;
7. Product A + B fixed bundle price;
8. A + B bundle percentage discount;
9. buy A / receive 20% off B;
10. furniture 15% excluding Brand X and clearance;
11. gross-margin safeguard;
12. contribution-per-unit safeguard;
13. contribution-margin safeguard;
14. one redemption per customer;
15. first 500 redemptions;
16. fixed promotional SKU price;
17. STOP existing promotion;
18. MODIFY 15% → 20%;
19. overlapping non-stackable promotions;
20. missing membership snapshot;
21. invalid percentage discount.

## Non-scope

No promotion optimizer, recommendation ranking, demand/lift forecasting, coupon generation service, Shopify/provider execution, campaign messaging, checkout engine, elasticity model or Growth Operator decision policy is built in Step 5.
